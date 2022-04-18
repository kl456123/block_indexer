import { ethers } from "ethers";

import {
  UniswapV2Indexer,
  BalancerV2SubgraphIndexer,
  CurveIndexer,
  DodoIndexer,
  UniswapV2SubgraphIndexer,
  UniswapV3SubgraphIndexer,
} from "./markets";
import { Database } from "./mongodb";
import {
  curveRegistryAddr,
  curveV2RegistryAddr,
  stablePoolFactoryAddr,
  cryptoPoolFactoryAddr,
  poolCollectionName,
  tokenCollectionName,
} from "./constants";
import { logger } from './logging';
import { Token } from './types';

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

  // const indexer = new CurveIndexer(
    // provider,
    // database,
    // poolCollectionName,
    // tokenCollectionName,
    // {
      // curveRegistryAddr,
      // stablePoolFactoryAddr,
      // curveV2RegistryAddr,
      // cryptoPoolFactoryAddr,
    // }
  // );

  // const indexer = new DodoIndexer(database, poolCollectionName);
  // await indexer.processAll();
  // const indexer = new UniswapV2SubgraphIndexer(database, poolCollectionName, tokenCollectionName);
  // const indexer = new BalancerV2SubgraphIndexer(database, poolCollectionName, tokenCollectionName);
  // const indexer = new UniswapV3SubgraphIndexer(database, poolCollectionName, tokenCollectionName);
  // await indexer.processAllPools();
  // await indexer.processAllTokens();

    const tokens = await database.loadMany<Token>({address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"}, tokenCollectionName);
    logger.info(tokens);

  await database.close();
}

main();
