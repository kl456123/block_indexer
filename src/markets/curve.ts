import { gql, GraphQLClient } from "graphql-request";
import Timeout from "await-timeout";
import retry from "async-retry";

import { ethers, Contract, utils } from "ethers";
import { logger } from "../logging";
import { Pool, Protocol, Token } from "../types";
import { Database } from "../mongodb";
import _ from "lodash";
import { MarketInterface } from "./market_interface";

export type RawSubgraphPool = {
  id: string;
  pool: {
    address: string;
    coins: string[];
    basePool: string;
  };
  volumeUSD: string;
};

const CURVE_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/convex-community/volume-mainnet";

export class CurveIndexer implements MarketInterface {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected timeout: number;
  protected client: GraphQLClient;
  constructor(
    protected provider: ethers.providers.BaseProvider,
    protected database: Database,
    protected poolCollectionName: string,
    protected tokenCollectionName: string
  ) {
    this.subgraph_url = CURVE_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
    this.timeout = 360000;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        dailySwapVolumeSnapshots(first: $pageSize, where: { id_gt: $id }) {
          id
          pool {
            address
            coins
            basePool
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
              dailySwapVolumeSnapshots: RawSubgraphPool[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.dailySwapVolumeSnapshots;
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

  async processAllPools() {
    const subgraphPools = await this.fetchPoolsFromSubgraph();
    const pools: Pool[] = subgraphPools.map((subgraphPool) => ({
      protocol: Protocol.Curve,
      id: subgraphPool.id,
      tokens: subgraphPool.pool.coins.map((coin) => ({
        id: coin,
        symbol: "UNKNOWN",
      })),
      dailyVolumeUSD: subgraphPool.volumeUSD,
    }));
    await this.database.saveMany(pools, this.poolCollectionName);
  }
}
