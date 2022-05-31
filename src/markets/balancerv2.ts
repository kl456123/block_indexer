import retry from "async-retry";
import Timeout from "await-timeout";
import { BigNumber } from "bigNumber.js";
import { gql, GraphQLClient } from "graphql-request";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { PRICING_ASSETS, USD_STABLE_ASSETS } from "../tokens";
import { Pool, Protocol, Token } from "../types";
import { MarketInterface } from "./market_interface";

const BALANCERV2_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2";

export type RawSubgraphPool = {
  id: string;
  tokens: Array<{ address: string; balance: string }>;
};

export type RawSubgraphToken = {
  id: string;
  decimals: string;
  symbol: string;
  latestPrice: {
    pricingAsset: string;
    price: string;
  };
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
        pools(first: $pageSize, where: { totalLiquidity_gt: 0, id_gt: $id }) {
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
      protocol: Protocol.BalancerV2,
      id: subgraphPool.id,
      tokens: subgraphPool.tokens.map((token) => token.address),
      reserves: subgraphPool.tokens.map((token) => token.balance),
    }));
    await this.database.saveMany(pools, this.poolCollectionName);
  }

  async fetchTokensFromSubgraph() {
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        tokens(first: $pageSize, where: { id_gt: $id }) {
          id
          decimals
          symbol
          latestPrice {
            pricingAsset
            price
          }
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
    const subgraphTokens = await this.fetchTokensFromSubgraph();
    // get price of pricing asset first
    const pricingAssetAddrs = PRICING_ASSETS.map((asset) =>
      asset.address.toLowerCase()
    );
    const usdAssetAddrs = USD_STABLE_ASSETS.map((asset) =>
      asset.address.toLowerCase()
    );
    const pricingTokens = subgraphTokens.filter((subgraphToken) =>
      pricingAssetAddrs.includes(subgraphToken.id)
    );
    const usdTokens = pricingTokens.filter((subgraphToken) =>
      usdAssetAddrs.includes(subgraphToken.latestPrice.pricingAsset)
    );
    const usdPriceForPricingAsset = pricingTokens.map((pricingToken) => {
      if (usdAssetAddrs.includes(pricingToken.latestPrice.pricingAsset)) {
        return pricingToken.latestPrice.price;
      }
      const tokens = usdTokens.filter(
        (usdToken) => usdToken.id === pricingToken.latestPrice.pricingAsset
      );
      if (!tokens.length) {
        throw new Error(`cannot pricing for asset: ${pricingToken.id}`);
      }
      return new BigNumber(tokens[0].latestPrice.price).multipliedBy(
        pricingToken.latestPrice.price
      );
    });
    const pools: Token[] = subgraphTokens.map((subgraphToken) => ({
      protocol: Protocol.BalancerV2,
      address: subgraphToken.id,
      symbol: subgraphToken.symbol,
      decimals: parseInt(subgraphToken.decimals),
      derivedUSD: subgraphToken.latestPrice
        ? new BigNumber(subgraphToken.latestPrice.price)
            .multipliedBy(
              usdPriceForPricingAsset[
                pricingTokens.findIndex(
                  (pricingToken) =>
                    pricingToken.id === subgraphToken.latestPrice.pricingAsset
                )
              ]
            )
            .toString()
        : "0",
    }));
    await this.database.saveMany(pools, this.tokenCollectionName);
  }
}
