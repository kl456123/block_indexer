import { gql, GraphQLClient } from "graphql-request";
import Timeout from "await-timeout";
import retry from "async-retry";
import { Pool, Protocol } from "../types";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { utils } from 'ethers';

const DODO_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/dodoex/dodoex-v2";

export type RawSubgraphPool = {
  id: string;
    baseToken: {id: string, decimals: string}
    quoteToken: {id: string, decimals: string}
    quoteReserve: string;
    baseReserve: string;
};

export class DodoIndexer {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected timeout: number;
  protected client: GraphQLClient;
  constructor(protected database: Database, protected collectionName: string) {
    this.subgraph_url = DODO_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
    this.timeout = 360000;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query fetchTopPools($pageSize: Int!, $id: String) {
        pairs(first: $pageSize, where: { quoteReserve_gt: 0 id_gt: $id }) {
          id
          baseToken {id decimals}
          quoteToken {id decimals}
          quoteReserve
          baseReserve
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
              pairs: RawSubgraphPool[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.pairs;
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

  async processAll() {
    const subgraphPools = await this.fetchPoolsFromSubgraph();
    const pools: Pool[] = subgraphPools.map((subgraphPool) => ({
      protocol: Protocol.BalancerV2,
      id: subgraphPool.id,
      tokens: [subgraphPool.baseToken.id, subgraphPool.quoteToken.id],
      reserves: [
          utils.parseUnits(subgraphPool.baseReserve, subgraphPool.baseToken.decimals).toString(),
          utils.parseUnits(subgraphPool.quoteReserve, subgraphPool.quoteToken.decimals).toString(),
      ],
      reservesUSD: [],
    }));
    await this.database.saveMany(pools, this.collectionName);
  }
}
