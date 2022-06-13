import { Contract, ethers, utils, BigNumber } from "ethers";
import _ from "lodash";
import { logger } from "../logging";
import { Database } from "../mongodb";
import {
  CryptoPoolFactory,
  CryptoPoolFactory__factory,
  CryptoRegistry,
  CryptoRegistry__factory,
  CurvePoolFactory,
  CurvePoolFactory__factory,
  CurveRegistry,
  CurveRegistry__factory,
} from "../typechain";
import { Pool, Protocol } from "../types";
import { getTokensInfo } from "../utils";
import { MarketInterface } from "./market_interface";

export type CurveAddresses = {
  curveRegistryAddr: string;
  curveV2RegistryAddr: string;
  stablePoolFactoryAddr: string;
  cryptoPoolFactoryAddr: string;
};

export class CurveIndexer implements MarketInterface {
  protected stablePoolFactoryContract: CurvePoolFactory;
  protected cryptoPoolFactoryContract: CryptoPoolFactory;
  protected registryContract: CurveRegistry;
  protected registryV2Contract: CryptoRegistry;

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
      const liquidity = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum)
        .map((reserve, ind) =>
          utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
        );
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.Curve,
        tokens,
        liquidity,
        poolData: { isMeta, isLending, wrappedToken },
      };
      pools.push(pool);
    }
    logger.info(`processing ${pools.length} pools from main registry`);
    return pools;
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
      const liquidity = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum)
        .map((reserve, ind) =>
          utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
        );
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        liquidity,
        poolData: { isMeta: false }, // all crypto pools isn't metapool
      };
      pools.push(pool);
    }
    logger.info(`processing ${pools.length} pools from crypto registry`);
    return pools;
  }

  async handleStablePoolDeployed() {
    const poolsAddr = await this.handlePools(this.stablePoolFactoryContract);
    const pools = [];
    for (let i = 0; i < poolsAddr.length; ++i) {
      const poolAddr = poolsAddr[i];
      let tokens: string[];
      let liquidity: string[];
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
          let balancesBigNumber: BigNumber[];
          // handle corner cases
          try {
            balancesBigNumber =
              await this.stablePoolFactoryContract.get_underlying_balances(
                poolAddr
              );
          } catch (error) {
            balancesBigNumber = new Array(4).fill(BigNumber.from(0));
          }
          const tokensInfo = await getTokensInfo(tokens, this.provider);
          liquidity = balancesBigNumber
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
          liquidity = balancesBigNumber
            .map((balanceBigNumber) => balanceBigNumber.toString())
            .slice(0, coinsNum)
            .map((reserve, ind) =>
              utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
            );
        }
      } catch (error) {
        logger.error(`address: ${poolAddr} isMeta: ${isMeta}, error: ${error}`);
        continue;
      }
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.Curve,
        tokens,
        liquidity,
        poolData: { isMeta }, // all crypto pools isn't metapool
      };
      pools.push(pool);
    }
    logger.info(`processing ${pools.length} pools from metapool factory`);

    return pools;
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
      const liquidity = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum)
        .map((reserve, ind) =>
          utils.formatUnits(reserve, tokensInfo[ind].decimals).toString()
        );
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        liquidity,
        poolData: { isMeta: false }, // all crypto pools isn't metapool
      };
      pools.push(pool);
    }
    logger.info(`processing ${pools.length} crypto pools from factory`);
    return pools;
  }

  async handlePools(contract: Contract) {
    const poolCount = (await contract.pool_count()).toNumber();
    const poolPromises = [];
    for (let i = 0; i < poolCount; ++i) {
      const poolPromise = contract.pool_list(i);
      poolPromises.push(poolPromise);
    }
    const pools = await Promise.all(poolPromises);
    return pools;
  }

  async processAllPools() {
    const allPools = await Promise.all([
      this.handleRegistryPoolAdded(),
      this.handleStablePoolDeployed(),
      this.handleRegistryV2PoolAdded(),
      this.handleCryptoPoolDeployed(),
    ]);
    const pools = allPools.flat();
    await this.database.saveMany(pools, this.poolCollectionName);
  }

  async processAllTokens() {
    throw new Error(`Unimplementation Error`);
  }
}
