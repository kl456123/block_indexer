import retry from "async-retry";
import { gql, GraphQLClient } from "graphql-request";

import { DefaultCollectionName } from "../constants";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { CollectionName, DailyVolumeSnapshot, Protocol } from "../types";

import { MarketInterface } from "./market_interface";

const UNISWAPV2_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/ianlapham/uniswapv2";

export type RawSubgraphPool = {
  id: string;
  token0: {
    id: string;
    symbol: string;
  };
  token1: {
    id: string;
    symbol: string;
  };
  dailyVolumeUSD: string;
};

export class UniswapV2SubgraphIndexer implements MarketInterface {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected client: GraphQLClient;
  constructor(
    protected database: Database,
    protected collectionName: CollectionName = DefaultCollectionName
  ) {
    this.subgraph_url = UNISWAPV2_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url, { timeout: 4000 });
    this.retries = 3;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        pairDayDatas(first: $pageSize, where: { id_gt: $id }) {
          id
          token0 {
            id
            symbol
          }
          token1 {
            id
            symbol
          }
          dailyVolumeUSD
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

    allPools = await getPools();
    return allPools;
  }

  async processAllSnapshots() {
    const subgraphPools = await this.fetchPoolsFromSubgraph();
    const snapshots: DailyVolumeSnapshot[] = subgraphPools.map(
      (subgraphPool) => {
        const [pairAddress, dayId] = subgraphPool.id.split("-");
        return {
          id: subgraphPool.id,
          pool: {
            id: pairAddress,
            tokens: [subgraphPool.token0, subgraphPool.token1],
            protocol: Protocol.UniswapV2,
          },
          dayId: dayId,
          volumeUSD: subgraphPool.dailyVolumeUSD,
        };
      }
    );
    await this.database.saveMany(snapshots, this.collectionName.snapshot);
  }

  async processAllPools() {}
}
