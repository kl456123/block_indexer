import { ethers, BigNumber } from "ethers";

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
import { Token, Pool, Protocol } from './types';
import _ from 'lodash';

import * as dotenv from "dotenv";
dotenv.config();

async function pricingPools(database: Database){
    const tokens = await database.loadMany<Token>({}, poolCollectionName);
    const tokensMap: Record<string, string> = {};
    // TODO generate mapping between tokens address with their usd prices
    const pools = await database.loadMany<Pool>({reservesUSD: {$exists: false}}, poolCollectionName);
    _(pools).forEach(pool=>{
        pool.tokens[0]
        pool.reserves.map((reserve, ind)=>BigNumber.from(tokensMap[pool.tokens[ind]]).mul(reserve));
    });
    logger.info(pools.length);
}

async function savePools(database: Database, provider: ethers.providers.BaseProvider){
  const uniswapV2Indexer = new UniswapV2SubgraphIndexer(database, poolCollectionName, tokenCollectionName);
  const balancerV2Indexer = new BalancerV2SubgraphIndexer(database, poolCollectionName, tokenCollectionName);
  const uniswapV3Indexer = new UniswapV3SubgraphIndexer(database, poolCollectionName, tokenCollectionName);
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
  const indexers = [uniswapV2Indexer, balancerV2Indexer, uniswapV3Indexer, curveIndexer];
  const protocols = [Protocol.UniswapV2, Protocol.BalancerV2, Protocol.UniswapV3, Protocol.Curve];
    for(let i=0;i<indexers.length;++i){
        const indexer = indexers[i];
        logger.info(`processing indexer: ${Protocol[protocols[i]]}`);
        // await indexer.processAllPools();
        await indexer.processAllTokens();
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
