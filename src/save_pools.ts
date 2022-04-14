import { ethers } from "ethers";

import { UniswapV2Indexer } from "./markets/uniswapv2";
import { Database } from "./mongodb";
import { Pool } from "./types";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  // const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);
  const factoryAddr = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const poolCollectionName = "pools";

  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);

  const indexer = new UniswapV2Indexer(
    provider,
    database,
    factoryAddr,
    poolCollectionName
  );
  // const pool = await indexer.processSingle(0);
  // console.log(pool);

  // process all pools from uniswapv2
  await indexer.processAll();

  await database.close();
}

main();
