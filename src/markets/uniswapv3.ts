import retry from "async-retry";
import { gql, GraphQLClient } from "graphql-request";

import { DefaultCollectionName } from "../constants";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { CollectionName, DailyVolumeSnapshot, Protocol } from "../types";

import { MarketInterface } from "./market_interface";

const UNISWAPV3_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";

export type RawSubgraphPool = {
  id: string;
  pool: {
    feeTier: string;
    token0: {
      id: string;
      symbol: string;
    };
    token1: {
      id: string;
      symbol: string;
    };
  };
  volumeUSD: string;
};

export type RawSubgraphToken = {
  id: string;
  derivedETH: string;
  decimals: string;
  symbol: string;
};

export class UniswapV3SubgraphIndexer implements MarketInterface {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected client: GraphQLClient;
  constructor(
    protected database: Database,
    protected collectionName: CollectionName = DefaultCollectionName
  ) {
    this.subgraph_url = UNISWAPV3_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url, { timeout: 4000 });
    this.retries = 3;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        poolDayDatas(first: $pageSize, where: { id_gt: $id }) {
          id
          pool {
            token0 {
              id
              symbol
            }
            token1 {
              id
              symbol
            }
            feeTier
          }
          volumeUSD
        }
      }
    `;
    let allPools: RawSubgraphPool[] = [];
    // get all pools using page mode
    const getPools = async (): Promise<RawSubgraphPool[]> => {
      let lastId = "";
      let pools: RawSubgraphPool[] = [];
      let poolsPage: RawSubgraphPool[] = [];
      do {
        await retry(
          async () => {
            const poolsResult = await this.client.request<{
              poolDayDatas: RawSubgraphPool[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.poolDayDatas;
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

    allPools = await getPools();
    return allPools;
  }

  async processAllSnapshots() {
    const subgraphPools = await this.fetchPoolsFromSubgraph();
    const pools: DailyVolumeSnapshot[] = subgraphPools.map((subgraphPool) => {
      const [pairAddress, dayId] = subgraphPool.id.split("-");
      return {
        pool: {
          protocol: Protocol.UniswapV3,
          tokens: [subgraphPool.pool.token0, subgraphPool.pool.token1],
          id: pairAddress,
          poolData: {
            feeTier: subgraphPool.pool.feeTier,
          },
        },
        id: subgraphPool.id,
        volumeUSD: subgraphPool.volumeUSD,
        dayId,
      };
    });
    await this.database.saveMany(pools, this.collectionName.snapshot);
  }

  async processAllPools() {}
}
