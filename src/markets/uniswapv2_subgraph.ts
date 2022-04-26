import { gql, GraphQLClient } from "graphql-request";
import retry from "async-retry";
import { Pool, Protocol, Token } from "../types";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { MarketInterface } from "./market_interface";

const UNISWAPV2_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/ianlapham/uniswapv2";

export type RawSubgraphPool = {
  id: string;
  pairAddress: string;
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
    protected poolCollectionName: string,
    protected tokenCollectionName: string
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
          pairAddress
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

  async processAllPools() {
    const subgraphPools = await this.fetchPoolsFromSubgraph();
    const pools: Pool[] = subgraphPools.map((subgraphPool) => ({
      protocol: Protocol.UniswapV2,
      id: subgraphPool.id,
      tokens: [subgraphPool.token0, subgraphPool.token1],
      dailyVolumeUSD: subgraphPool.dailyVolumeUSD,
    }));
    await this.database.saveMany(pools, this.poolCollectionName);
  }
}
