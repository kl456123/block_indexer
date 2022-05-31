import { BigNumber } from "bignumber.js";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import _ from "lodash";
import {
  cryptoPoolFactoryAddr,
  curveRegistryAddr,
  curveV2RegistryAddr,
  poolCollectionName,
  stablePoolFactoryAddr,
  tokenCollectionName,
} from "./constants";
import { logger } from "./logging";
import {
  BalancerV2SubgraphIndexer,
  CurveIndexer,
  DodoIndexer,
  UniswapV2SubgraphIndexer,
  UniswapV3SubgraphIndexer,
} from "./markets";
import { Database } from "./mongodb";
import { Pool, Protocol, Token } from "./types";

dotenv.config();

async function getTokenPrice(database: Database) {
  const tokens = await database.loadMany<Token>({}, tokenCollectionName);
  const tokensMap: Record<string, string[]> = {};
  _(tokens).forEach((token) => {
    if (parseInt(token.derivedUSD) === 0) {
      return;
    }
    if (token.address in tokensMap) {
      tokensMap[token.address.toLowerCase()].push(token.derivedUSD);
    }
    tokensMap[token.address.toLowerCase()] = [token.derivedUSD];
  });
  const tokensPriceMap: Record<string, BigNumber> = {};
  _(tokensMap).forEach((values, addr) => {
    // TODO use average price weighted by trade volume
    const sum = values.reduce(
      (sum, value) => new BigNumber(value).plus(sum),
      new BigNumber(0)
    );
    tokensPriceMap[addr.toLowerCase()] = values.length
      ? sum.dividedBy(values.length)
      : new BigNumber(0);
  });
  logger.info(`num of tokens: ${Object.keys(tokensPriceMap).length}`);
  return tokensPriceMap;
}

async function pricingPools(database: Database) {
  const tokensPriceMap = await getTokenPrice(database);
  // TODO generate mapping between tokens address with their usd prices
  const pools = await database.loadMany<Pool>(
    { reservesUSD: { $exists: false } },
    poolCollectionName
  );
  if (!pools.length) {
    logger.info(`all pools are modified already`);
    return;
  }
  _(pools).forEach((pool) => {
    pool.reservesUSD = pool.reserves.map((reserve, ind) =>
      tokensPriceMap[pool.tokens[ind].toLowerCase()]
        ? tokensPriceMap[pool.tokens[ind].toLowerCase()]
            .multipliedBy(reserve)
            .toString()
        : "0"
    );
  });
  // TODO find a better way to update each elements of pools array
  await database.deleteMany(
    { reservesUSD: { $exists: false } },
    poolCollectionName
  );
  await database.saveMany(pools, poolCollectionName);
  logger.info(`${pools.length} of pools are updated`);
}

async function savePools(
  database: Database,
  provider: ethers.providers.BaseProvider
) {
  const uniswapV2Indexer = new UniswapV2SubgraphIndexer(
    database,
    poolCollectionName,
    tokenCollectionName
  );
  const balancerV2Indexer = new BalancerV2SubgraphIndexer(
    database,
    poolCollectionName,
    tokenCollectionName
  );
  const uniswapV3Indexer = new UniswapV3SubgraphIndexer(
    database,
    poolCollectionName,
    tokenCollectionName
  );
  const curveIndexer = new CurveIndexer(
    provider,
    database,
    poolCollectionName,
    tokenCollectionName,
    {
      curveRegistryAddr,
      stablePoolFactoryAddr,
      curveV2RegistryAddr,
      cryptoPoolFactoryAddr,
    }
  );
  const dodoIndexer = new DodoIndexer(database, poolCollectionName);
  const indexers = [curveIndexer];
  const protocols = [Protocol.Curve];
  for (let i = 0; i < indexers.length; ++i) {
    const indexer = indexers[i];
    logger.info(`processing indexer: ${Protocol[protocols[i]]}`);
    await indexer.processAllPools();
    // await indexer.processAllTokens();
  }
}

async function main() {
  // const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);

  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);

  // await savePools(database, provider);
  await pricingPools(database);

  await database.close();
}

main();
