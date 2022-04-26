import { gql, GraphQLClient } from "graphql-request";
import Timeout from "await-timeout";
import retry from "async-retry";
import { Pool, Protocol } from "../types";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { MarketInterface } from "./market_interface";

const BALANCERV2_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2";

export type RawSubgraphPool = {
  id: string;
  pool: { tokens: { address: string; symbol: string }[] };
  swapVolume: string;
};

export class BalancerV2SubgraphIndexer implements MarketInterface {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected timeout: number;
  protected client: GraphQLClient;
  constructor(
    protected database: Database,
    protected poolCollectionName: string,
    protected tokenCollectionName: string
  ) {
    this.subgraph_url = BALANCERV2_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
    this.timeout = 360000;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query fetchTopPools($pageSize: Int!, $id: String) {
        poolSnapshots(first: $pageSize, where: { id_gt: $id }) {
          id
          pool {
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
      protocol: Protocol.BalancerV2,
      id: subgraphPool.id,
      tokens: subgraphPool.pool.tokens.map((token) => ({
        id: token.address,
        symbol: token.symbol,
      })),
      dailyVolumeUSD: subgraphPool.swapVolume,
    }));
    await this.database.saveMany(pools, this.poolCollectionName);
  }
}
