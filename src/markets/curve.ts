import retry from "async-retry";
import { gql, GraphQLClient } from "graphql-request";

import { DAY, DefaultCollectionName } from "../constants";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { CollectionName, DailyVolumeSnapshot, Protocol } from "../types";

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
  protected client: GraphQLClient;
  constructor(
    protected database: Database,
    protected collectionName: CollectionName = DefaultCollectionName
  ) {
    this.subgraph_url = CURVE_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
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
        logger.info(`processing ${pools.length}th snapshots`);
      } while (poolsPage.length > 0);

      return pools;
    };

    allPools = await getPools();
    return allPools;
  }

  async processAllSnapshots() {
    const subgraphPools = await this.fetchPoolsFromSubgraph();
    const pools: DailyVolumeSnapshot[] = subgraphPools.map((subgraphPool) => {
      const [pairAddress, daytime] = subgraphPool.id.split("-");
      return {
        id: subgraphPool.id,
        pool: {
          protocol: Protocol.Curve,
          tokens: subgraphPool.pool.coins.map((coin) => ({
            id: coin,
            symbol: "UNKNOWN",
          })),
          poolData: { basePool: subgraphPool.pool.basePool },
          id: pairAddress,
        },
        dayId: (parseInt(daytime) / DAY).toString(),
        volumeUSD: subgraphPool.volumeUSD,
      };
    });
    await this.database.saveMany(pools, this.collectionName.snapshot);
  }

  async processAllPools() {}
}
