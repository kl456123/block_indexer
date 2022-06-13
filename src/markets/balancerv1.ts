import retry from "async-retry";
import Timeout from "await-timeout";
import { gql, GraphQLClient } from "graphql-request";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { Pool, Protocol } from "../types";
import { MarketInterface } from "./market_interface";

const BALANCER_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer";

export type RawSubgraphPool = {
  id: string;
  tokens: Array<{ address: string; balance: string }>;
};

export class BalancerSubgraphIndexer implements MarketInterface {
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
    this.subgraph_url = BALANCER_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
    this.timeout = 36000;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query fetchTopPools($pageSize: Int!, $id: String) {
        pools(first: $pageSize, where: { id_gt: $id }) {
          id
          tokens {
            address
            balance
          }
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
              pools: RawSubgraphPool[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.pools;
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
      protocol: Protocol.Balancer,
      id: subgraphPool.id,
      tokens: subgraphPool.tokens.map((token) => token.address),
      liquidity: subgraphPool.tokens.map((token) => token.balance),
    }));
    await this.database.saveMany(pools, this.poolCollectionName);
  }

  async processAllTokens() {}
}
