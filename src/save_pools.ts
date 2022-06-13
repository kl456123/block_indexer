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
  BalancerSubgraphIndexer,
  BalancerV2SubgraphIndexer,
  CurveIndexer,
  DodoSubgraphIndexer,
  UniswapV2SubgraphIndexer,
  UniswapV3SubgraphIndexer,
} from "./markets";
import { Database } from "./mongodb";
import { Pool, Protocol, Token } from "./types";

dotenv.config();

async function savePools(
  database: Database,
  provider: ethers.providers.JsonRpcProvider
) {
  const uniswapV2Indexer = new UniswapV2SubgraphIndexer(
    database,
    poolCollectionName,
    tokenCollectionName
  );

  const balancerIndexer = new BalancerSubgraphIndexer(
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
  const dodoIndexer = new DodoSubgraphIndexer(database, poolCollectionName);
  const indexers = [
    uniswapV2Indexer,
    balancerIndexer,
    balancerV2Indexer,
    uniswapV3Indexer,
    curveIndexer,
    dodoIndexer,
  ];
  const protocols = [
    Protocol.UniswapV2,
    Protocol.Balancer,
    Protocol.BalancerV2,
    Protocol.UniswapV3,
    Protocol.Curve,
    Protocol.DODOV2,
  ];
  for (let i = 0; i < indexers.length; ++i) {
    const indexer = indexers[i];
    logger.info(`processing indexer: ${Protocol[protocols[i]]}`);
    await indexer.processAllPools();
  }
}

async function main() {
  // const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`;
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);

  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);

  await savePools(database, provider);

  await database.close();
}

main();
