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
import { ethers, Contract } from "ethers";
import { logger } from "../logging";
import { Pool, Protocol } from "../types";
import { Database } from "../mongodb";

export type CurveAddresses = {
  curveRegistryAddr: string;
  curveV2RegistryAddr: string;
  stablePoolFactoryAddr: string;
  cryptoPoolFactoryAddr: string;
};

export class CurveIndexer {
  protected stablePoolFactoryContract: CurvePoolFactory;
  protected cryptoPoolFactoryContract: CryptoPoolFactory;
  protected registryContract: CurveRegistry;
  protected registryV2Contract: CryptoRegistry;
  constructor(
    protected provider: ethers.providers.BaseProvider,
    protected database: Database,
    protected collectionName: string,
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
      const reserves = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum);
      const reservesUSD = Array(reserves.length).fill("0");
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        reserves,
        reservesUSD,
        poolData: { isMeta, isLending, wrappedToken },
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.collectionName);
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
      const reserves = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum);
      const reservesUSD = Array(reserves.length).fill("0");
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        reserves,
        reservesUSD,
        poolData: { isMeta: false }, // all crypto pools isn't metapool
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.collectionName);
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
          reserves = balancesBigNumber
            .map((balanceBigNumber) => balanceBigNumber.toString())
            .slice(0, coinsNum);
        } else {
          const coinsBigNumber =
            await this.stablePoolFactoryContract.get_n_coins(poolAddr);
          const coinsNum = coinsBigNumber.toNumber();
          tokens = (
            await this.stablePoolFactoryContract.get_coins(poolAddr)
          ).slice(0, coinsNum);
          const balancesBigNumber =
            await this.stablePoolFactoryContract.get_balances(poolAddr);
          reserves = balancesBigNumber
            .map((balanceBigNumber) => balanceBigNumber.toString())
            .slice(0, coinsNum);
        }
      } catch (error) {
        logger.error(`address: ${poolAddr} isMeta: ${isMeta}`);
        continue;
      }
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        reserves,
        reservesUSD: Array(reserves.length).fill("0"),
        poolData: { isMeta }, // all crypto pools isn't metapool
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.collectionName);
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
      const reserves = balancesBigNumber
        .map((balanceBigNumber) => balanceBigNumber.toString())
        .slice(0, coinsNum);
      const reservesUSD = Array(reserves.length).fill("0");
      const pool: Pool = {
        id: poolAddr,
        protocol: Protocol.CurveV2,
        tokens,
        reserves,
        reservesUSD,
        poolData: { isMeta: false }, // all crypto pools isn't metapool
      };
      pools.push(pool);
      logger.info(pool);
    }
    await this.database.saveMany(pools, this.collectionName);
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

  async pricingUSD(token: string) {}
}
