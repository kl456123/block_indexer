import retry from "async-retry";
import Timeout from "await-timeout";
import BigNumber from "bignumber.js";
import { gql, GraphQLClient } from "graphql-request";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { Pool, Protocol, Token } from "../types";
import { MarketInterface } from "./market_interface";

const UNISWAPV2_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/ianlapham/uniswapv2";

export type RawSubgraphPool = {
  id: string;
  token0: {
    id: string;
  };
  token1: {
    id: string;
  };
  reserve0: string;
  reserve1: string;
  reserveUSD: string;
};

export type RawSubgraphToken = {
  id: string;
  derivedETH: string;
  decimals: string;
  symbol: string;
};

export class UniswapV2SubgraphIndexer implements MarketInterface {
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
    this.subgraph_url = UNISWAPV2_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
    this.timeout = 360000;
  }

  async fetchPoolsFromSubgraph() {
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        pairs(first: $pageSize, where: { id_gt: $id }) {
          id
          token0 {
            id
          }
          token1 {
            id
          }
          reserve0
          reserve1
          reserveUSD
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
      protocol: Protocol.UniswapV2,
      id: subgraphPool.id,
      tokens: [subgraphPool.token0.id, subgraphPool.token1.id],
      reserves: [subgraphPool.reserve0, subgraphPool.reserve1],
      fillData: { tvlUSD: subgraphPool.reserveUSD },
    }));
    await this.database.saveMany(pools, this.poolCollectionName);
  }

  async fetchETHPrice() {
    const query = gql`
      query getPools($id: String) {
        bundle(id: $id) {
          ethPrice
        }
      }
    `;
    const bundleResult = await this.client.request<{
      bundle: { ethPrice: string };
    }>(query, { id: "1" });
    return bundleResult.bundle.ethPrice;
  }

  async fetchTokensFromSubgraph() {
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        tokens(first: $pageSize, where: { id_gt: $id }) {
          id
          derivedETH
          decimals
          symbol
        }
      }
    `;
    let allPools: RawSubgraphToken[] = [];
    const timeout = new Timeout();
    // get all pools using page mode
    const getPools = async (): Promise<RawSubgraphToken[]> => {
      let lastId = "";
      let pools: RawSubgraphToken[] = [];
      let poolsPage: RawSubgraphToken[] = [];
      do {
        await retry(
          async () => {
            const poolsResult = await this.client.request<{
              tokens: RawSubgraphToken[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.tokens;
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
        logger.info(`processing ${pools.length}th tokens`);
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

  async processAllTokens() {
    const ethPrice = await this.fetchETHPrice();
    logger.info(`ethPrice: ${ethPrice}`);
    const subgraphTokens = await this.fetchTokensFromSubgraph();
    logger.info(`num of tokens: ${subgraphTokens.length}`);
    const ethPriceBigNumber = new BigNumber(ethPrice);
    const pools: Token[] = subgraphTokens.map((subgraphToken) => ({
      protocol: Protocol.UniswapV2,
      address: subgraphToken.id,
      symbol: subgraphToken.symbol,
      decimals: parseInt(subgraphToken.decimals),
      derivedETH: subgraphToken.derivedETH,
      derivedUSD: ethPriceBigNumber
        .multipliedBy(subgraphToken.derivedETH)
        .toString(),
    }));
    await this.database.saveMany(pools, this.tokenCollectionName);
  }
}
