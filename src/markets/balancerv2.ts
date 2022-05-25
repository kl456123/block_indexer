import retry from "async-retry";
import { gql, GraphQLClient } from "graphql-request";

import { DAY, DefaultCollectionName } from "../constants";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { CollectionName, DailyVolumeSnapshot, Protocol } from "../types";

import { MarketInterface } from "./market_interface";

const BALANCERV2_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2";

export type RawSubgraphPool = {
  id: string;
  pool: { tokens: { address: string; symbol: string }[]; address: string };
  swapVolume: string;
};

export class BalancerV2SubgraphIndexer implements MarketInterface {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected client: GraphQLClient;
  constructor(
    protected database: Database,
    protected collectionName: CollectionName = DefaultCollectionName
  ) {
    this.subgraph_url = BALANCERV2_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query fetchTopPools($pageSize: Int!, $id: String) {
        poolSnapshots(first: $pageSize, where: { id_gt: $id }) {
          id
          pool {
            address
            tokens {
              address
              symbol
            }
          }
          swapVolume
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
              poolSnapshots: RawSubgraphPool[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.poolSnapshots;
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
      const [poolAddress, daytime] = subgraphPool.id.split("-");
      return {
        id: subgraphPool.id,
        pool: {
          protocol: Protocol.BalancerV2,
          id: subgraphPool.pool.address,
          tokens: subgraphPool.pool.tokens.map((token) => ({
            id: token.address,
            symbol: token.symbol,
          })),
          poolData: { id: poolAddress },
        },
        volumeUSD: subgraphPool.swapVolume,
        dayId: (parseInt(daytime) / DAY).toString(),
      };
    });
    await this.database.saveMany(pools, this.collectionName.snapshot);
  }

  async processAllPools() {}
}
