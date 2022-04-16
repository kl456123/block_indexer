import { ethers } from "ethers";

import { UniswapV2Indexer, BalancerV2Indexer, CurveIndexer } from "./markets";
import { Database } from "./mongodb";
import {
  curveRegistryAddr,
  curveV2RegistryAddr,
  stablePoolFactoryAddr,
  cryptoPoolFactoryAddr,
  poolCollectionName,
} from "./constants";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  // const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);

  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);

  // const indexer = new UniswapV2Indexer(
  // provider,
  // database,
  // factoryAddr,
  // poolCollectionName
  // );
  // const indexer = new BalancerV2Indexer(database, poolCollectionName);
  // await indexer.processAll();

  const indexer = new CurveIndexer(provider, database, poolCollectionName, {
    curveRegistryAddr,
    stablePoolFactoryAddr,
    curveV2RegistryAddr,
    cryptoPoolFactoryAddr,
  });
  await indexer.handleRegistryPoolAdded();
  // await indexer.handleStablePoolDeployed();
  // await indexer.handleRegistryV2PoolAdded();
  // await indexer.handleCryptoPoolDeployed();

  await database.close();
}

main();
