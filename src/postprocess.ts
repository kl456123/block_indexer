import * as dotenv from "dotenv";
import { ethers } from "ethers";

import {
  cryptoPoolFactoryAddr,
  curveRegistryAddr,
  curveV2RegistryAddr,
  poolCollectionName,
  stablePoolFactoryAddr,
  tokenCollectionName,
} from "./constants";
import { logger } from "./logging";
import { CurveOnChainIndexer } from "./markets";
import { Database } from "./mongodb";
import { PoolWithVolume, Protocol, Token } from "./types";

dotenv.config();

async function main() {
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);
  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);
  const curveIndexer = new CurveOnChainIndexer(provider, database, {
    curveRegistryAddr,
    stablePoolFactoryAddr,
    curveV2RegistryAddr,
    cryptoPoolFactoryAddr,
  });
  const poolsOnChain = await curveIndexer.processAllPools(false);
  const poolsOnSubgraph = await database.loadMany<PoolWithVolume>(
    {},
    poolCollectionName
  );
  const tokens = await database.loadMany<Token>({}, tokenCollectionName);
  const pools: PoolWithVolume[] = poolsOnSubgraph
    .filter((pool) =>
      poolsOnChain.some(
        (poolOnChain) => poolOnChain.id.toLowerCase() === pool.id.toLowerCase()
      )
    )
    .map((pool) => {
      const poolOnChain = poolsOnChain.filter(
        (poolOnChain) => poolOnChain.id.toLowerCase() === pool.id.toLowerCase()
      )[0];
      const poolTokens: Token[] = poolOnChain.tokens.map((poolToken) => {
        const token = tokens.filter(
          (token) => token.id.toLowerCase() === poolToken.id.toLowerCase()
        );
        if (!token.length) {
          logger.info(`unknown tokens: ${poolToken.id}`);
          return poolToken;
        }
        return {
          id: poolToken.id,
          symbol: token[0].symbol,
          decimals: token[0].decimals,
          name: token[0].name,
        };
      });
      return {
        id: pool.id,
        protocol: pool.protocol,
        poolData: poolOnChain.poolData,
        tokens: poolTokens,
        latestDailyVolumeUSD: pool.latestDailyVolumeUSD,
        latestDayId: pool.latestDayId,
      };
    });
  await database.saveMany(pools, poolCollectionName);
  // remove old curve pools
  await database.deleteMany(
    { protoocl: Protocol.Curve, "poolData.basePool": { $exists: true } },
    poolCollectionName
  );

  await database.close();
}

main();
