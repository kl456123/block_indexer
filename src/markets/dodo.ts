import retry from "async-retry";
import Timeout from "await-timeout";
import { gql, GraphQLClient } from "graphql-request";

import { DefaultCollectionName } from "../constants";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { CollectionName, DailyVolumeSnapshot, Protocol } from "../types";

import { MarketInterface } from "./market_interface";

const DODO_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/dodoex/dodoex-v2";

export type RawSubgraphPool = {
  id: string;
  pairAddress: string;
  baseToken: { id: string; symbol: string };
  quoteToken: { id: string; symbol: string };
  volumeUSD: string;
};

export const DodoV1Addrs: string[] = [
  "0x75c23271661d9d143dcb617222bc4bec783eff34", //WETH-USDC
  "0x562c0b218cc9ba06d9eb42f3aef54c54cc5a4650", //LINK-USDC
  "0x9d9793e1e18cdee6cf63818315d55244f73ec006", //FIN-USDT
  "0xca7b0632bd0e646b0f823927d3d2e61b00fe4d80", //SNX-USDC
  "0x0d04146b2fe5d267629a7eb341fb4388dcdbd22f", //COMP-USDC
  "0x2109f78b46a789125598f5ad2b7f243751c2934d", //WBTC-USDC
  "0x1b7902a66f133d899130bf44d7d879da89913b2e", //YFI-USDC
  "0x1a7fe5d6f0bb2d071e16bdd52c863233bbfd38e9", //WETH-USDT
  "0x8876819535b48b551c9e97ebc07332c7482b4b2d", //DODO-USDT
  "0xc9f93163c99695c6526b799ebca2207fdf7d61ad", //USDT-USDC
  "0x94512fd4fb4feb63a6c0f4bedecc4a00ee260528", //AAVE-USDC
  "0x85f9569b69083c3e6aeffd301bb2c65606b5d575", //wCRES-USDT
  "0x181d93ea28023bf40c8bb94796c55138719803b4", //WOO-USDT
];

export class DodoIndexer implements MarketInterface {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected timeout: number;
  protected client: GraphQLClient;
  constructor(
    protected database: Database,
    protected collectionName: CollectionName = DefaultCollectionName
  ) {
    this.subgraph_url = DODO_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
    this.timeout = 360000;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query fetchTopPools($pageSize: Int!, $id: String) {
        pairDayDatas(first: $pageSize, where: { id_gt: $id }) {
          id
          pairAddress
          baseToken {
            id
            symbol
          }
          quoteToken {
            id
            symbol
          }
          volumeUSD
        }
      }
    `;
    let allPools: RawSubgraphPool[] = [];
    const timeout = new Timeout();
    // get all pools using page mode
    const getPools = async (): Promise<RawSubgraphPool[]> => {
      let lastId = "";
      let pools: RawSubgraphPool[] = [];
      let poolsPage: RawSubgraphPool[] = [];
      do {
        await retry(
          async () => {
            const poolsResult = await this.client.request<{
              pairDayDatas: RawSubgraphPool[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.pairDayDatas;
            pools = pools.concat(poolsPage);
            lastId = pools[pools.length - 1].id;
          },
          {
            retries: this.retries,
            onRetry: (error, retry) => {
              logger.error(
                `Failed request for page of pools from subgraph due to ${error}. Retry attempt: ${retry}`
              );
            },
          }
        );
        logger.info(`processing ${pools.length}th pools`);
      } while (poolsPage.length > 0);

      return pools;
    };

    try {
      const getPoolsPromise = getPools();
      const timerPromise = timeout.set(this.timeout).then(() => {
        throw new Error(
          `Timed out getting pools from subgraph: ${this.timeout}`
        );
      });
      allPools = await Promise.race([getPoolsPromise, timerPromise]);
    } finally {
      timeout.clear();
    }
    return allPools;
  }

  async processAllSnapshots() {
    const subgraphPools = await this.fetchPoolsFromSubgraph();
    const pools: DailyVolumeSnapshot[] = subgraphPools.map((subgraphPool) => ({
      id: subgraphPool.id,
      pool: {
        protocol: DodoV1Addrs.includes(subgraphPool.pairAddress.toLowerCase())
          ? Protocol.DODO
          : Protocol.DODOV2,
        id: subgraphPool.pairAddress,
        tokens: [subgraphPool.baseToken, subgraphPool.quoteToken],
      },
      dayId: subgraphPool.id.split("-").reverse()[0],
      volumeUSD: subgraphPool.volumeUSD,
    }));
    await this.database.saveMany(pools, this.collectionName.snapshot);
  }

  async processAllPools() {}
}
