import { gql, GraphQLClient } from "graphql-request";
import Timeout from "await-timeout";
import retry from "async-retry";

import {
  CurveRegistry__factory,
  CurveRegistry,
  CryptoPoolFactory,
  CryptoPoolFactory__factory,
  CryptoRegistry,
  CryptoRegistry__factory,
  CurvePoolFactory__factory,
  CurvePoolFactory,
} from "../typechain";
import { ethers, Contract, utils } from "ethers";
import { logger } from "../logging";
import { Pool, Protocol, Token } from "../types";
import { Database } from "../mongodb";
import _ from "lodash";
import { MarketInterface } from "./market_interface";
import { getTokensInfo } from "../utils";

export type CurveAddresses = {
  curveRegistryAddr: string;
  curveV2RegistryAddr: string;
  stablePoolFactoryAddr: string;
  cryptoPoolFactoryAddr: string;
};

export type RawSubgraphToken = {
  id: string;
  price: string;
  timestamp: string;
};

const CURVE_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/convex-community/volume-mainnet";

export class CurveIndexer implements MarketInterface {
  protected stablePoolFactoryContract: CurvePoolFactory;
  protected cryptoPoolFactoryContract: CryptoPoolFactory;
  protected registryContract: CurveRegistry;
  protected registryV2Contract: CryptoRegistry;

  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected timeout: number;
  protected client: GraphQLClient;
  constructor(
    protected provider: ethers.providers.BaseProvider,
    protected database: Database,
    protected poolCollectionName: string,
    protected tokenCollectionName: string,
    {
      curveRegistryAddr,
      curveV2RegistryAddr,
      stablePoolFactoryAddr,
      cryptoPoolFactoryAddr,
    }: CurveAddresses
  ) {
    this.stablePoolFactoryContract = CurvePoolFactory__factory.connect(
      stablePoolFactoryAddr,
      provider
    );
    this.cryptoPoolFactoryContract = CryptoPoolFactory__factory.connect(
      cryptoPoolFactoryAddr,
      provider
    );
    this.registryContract = CurveRegistry__factory.connect(
      curveRegistryAddr,
      provider
    );
    this.registryV2Contract = CryptoRegistry__factory.connect(
      curveV2RegistryAddr,
      provider
    );

    this.subgraph_url = CURVE_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
    this.timeout = 360000;
  }

  async handleRegistryPoolAdded() {
    const poolsAddr = await this.handlePools(this.registryContract);
    const pools = [];
    for (let i = 0; i < poolsAddr.length; ++i) {
      const poolAddr = poolsAddr[i];
      const isMeta = await this.registryContract.is_meta(poolAddr);
      const [, underlyingCoinsBigNumber] =
        await this.registryContract.get_n_coins(poolAddr);
      const coinsNum = underlyingCoinsBigNumber.toNumber();
      const tokens = (
        await this.registryContract.get_underlying_coins(poolAddr)
      ).slice(0, coinsNum);
      // check if it is lending pool
      const coins = await this.registryContract.get_coins(poolAddr);
      let isLending = false;
      let wrappedToken = undefined;
      if (coins[0] !== tokens[0]) {
        isLending = true;
        wrappedToken = coins.slice(0, coinsNum);
      }
      const balancesBigNumber =
        await this.registryContract.get_underlying_balances(poolAddr);
      const tokensInfo = await getTokensInfo(tokens, this.provider);
      const reserves = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum)
        .map((reserve, ind) =>
          utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
        );
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.Curve,
        tokens,
        reserves,
        poolData: { isMeta, isLending, wrappedToken },
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.poolCollectionName);
  }
  async handleRegistryV2PoolAdded() {
    const poolsAddr = await this.handlePools(this.registryV2Contract);
    const pools = [];
    for (let i = 0; i < poolsAddr.length; ++i) {
      const poolAddr = poolsAddr[i];
      const coinsNum = (
        await this.registryV2Contract.get_n_coins(poolAddr)
      ).toNumber();
      const tokens = (await this.registryV2Contract.get_coins(poolAddr)).slice(
        0,
        coinsNum
      );
      const balancesBigNumber = await this.registryV2Contract.get_balances(
        poolAddr
      );
      const tokensInfo = await getTokensInfo(tokens, this.provider);
      const reserves = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum)
        .map((reserve, ind) =>
          utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
        );
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        reserves,
        poolData: { isMeta: false }, // all crypto pools isn't metapool
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.poolCollectionName);
  }

  async handleStablePoolDeployed() {
    const poolsAddr = await this.handlePools(this.stablePoolFactoryContract);
    const pools = [];
    for (let i = 0; i < poolsAddr.length; ++i) {
      const poolAddr = poolsAddr[i];
      let tokens: string[];
      let reserves: string[];
      const isMeta = await this.stablePoolFactoryContract.is_meta(poolAddr);
      try {
        if (isMeta) {
          // can only be called by metapool
          const [, coinsBigNumber] =
            await this.stablePoolFactoryContract.get_meta_n_coins(poolAddr);
          const coinsNum = coinsBigNumber.toNumber();
          tokens = (
            await this.stablePoolFactoryContract.get_underlying_coins(poolAddr)
          ).slice(0, coinsNum);
          const balancesBigNumber =
            await this.stablePoolFactoryContract.get_underlying_balances(
              poolAddr
            );
          const tokensInfo = await getTokensInfo(tokens, this.provider);
          reserves = balancesBigNumber
            .map((balanceBigNumber) => balanceBigNumber.toString())
            .slice(0, coinsNum)
            .map((reserve, ind) =>
              utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
            );
        } else {
          const coinsBigNumber =
            await this.stablePoolFactoryContract.get_n_coins(poolAddr);
          const coinsNum = coinsBigNumber.toNumber();
          tokens = (
            await this.stablePoolFactoryContract.get_coins(poolAddr)
          ).slice(0, coinsNum);
          const tokensInfo = await getTokensInfo(tokens, this.provider);
          const balancesBigNumber =
            await this.stablePoolFactoryContract.get_balances(poolAddr);
          reserves = balancesBigNumber
            .map((balanceBigNumber) => balanceBigNumber.toString())
            .slice(0, coinsNum)
            .map((reserve, ind) =>
              utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
            );
        }
      } catch (error) {
        logger.error(`address: ${poolAddr} isMeta: ${isMeta}`);
        continue;
      }
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.Curve,
        tokens,
        reserves,
        poolData: { isMeta }, // all crypto pools isn't metapool
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.poolCollectionName);
  }

  async handleCryptoPoolDeployed() {
    const poolsAddr = await this.handlePools(this.cryptoPoolFactoryContract);
    const pools = [];
    for (let i = 0; i < poolsAddr.length; ++i) {
      const poolAddr = poolsAddr[i];
      // only two-coins pool deployed by cryptopool factory
      const coinsNum = 2;
      const tokens = (
        await this.cryptoPoolFactoryContract.get_coins(poolAddr)
      ).slice(0, coinsNum);
      const balancesBigNumber =
        await this.cryptoPoolFactoryContract.get_balances(poolAddr);
      const tokensInfo = await getTokensInfo(tokens, this.provider);
      const reserves = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum)
        .map((reserve, ind) =>
          utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
        );
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        reserves,
        poolData: { isMeta: false }, // all crypto pools isn't metapool
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.poolCollectionName);
  }

  async handlePools(contract: Contract) {
    const poolCount = (await contract.pool_count()).toNumber();
    const poolPromises = [];
    // logger.info(poolCount);
    for (let i = 0; i < poolCount; ++i) {
      const poolPromise = contract.pool_list(i);
      poolPromises.push(poolPromise);
      // logger.info(pool);
    }
    const pools = await Promise.all(poolPromises);
    return pools;
  }

  async processAllPools() {
    await Promise.all([
      this.handleRegistryPoolAdded(),
      this.handleStablePoolDeployed(),
      this.handleRegistryV2PoolAdded(),
      this.handleCryptoPoolDeployed(),
    ]);
  }

  async fetchTokensFromSubgraph() {
    const query = gql`
      query getPools($pageSize: Int!, $id: String) {
        tokenSnapshots(first: $pageSize, where: { id_gt: $id }) {
          id
          price
          timestamp
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
              tokenSnapshots: RawSubgraphToken[];
            }>(query, { pageSize: this.pageSize, id: lastId });
            poolsPage = poolsResult.tokenSnapshots;
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
    logger.info(`num of tokens: ${subgraphTokens.length}`);
    const tokens = subgraphTokens.map((subgraphToken) => {
      return {
        ...subgraphToken,
        address: subgraphToken.id.slice(0, 20),
      };
    });
    const tokenAddrs = _(tokens)
      .map((token) => token.address)
      .uniq()
      .value();
    const priceTokens = _(tokenAddrs)
      .map((tokenAddr) =>
        _(tokens)
          .filter((token) => tokenAddr === token.address)
          .sortBy((token) => token.timestamp)
          .last()
      )
      .value() as (RawSubgraphToken & { address: string })[];
    const pools: Token[] = priceTokens.map((priceToken) => ({
      protocol: Protocol.Curve,
      address: priceToken.id,
      symbol: "",
      decimals: 0,
      derivedETH: "0",
      derivedUSD: priceToken.price,
    }));
    await this.database.saveMany(pools, this.tokenCollectionName);
  }
}
