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
        protocol: Protocol.DODO,
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
