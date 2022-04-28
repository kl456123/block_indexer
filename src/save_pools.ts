import * as dotenv from "dotenv";
import { ethers } from "ethers";
import _ from "lodash";

import { poolCollectionName, snapshotCollectionName } from "./constants";
import { logger } from "./logging";
import {
  BalancerSubgraphIndexer,
  BalancerV2SubgraphIndexer,
  CurveIndexer,
  DodoIndexer,
  UniswapV2SubgraphIndexer,
  UniswapV3SubgraphIndexer,
} from "./markets";
import { Database } from "./mongodb";
import { DailyVolumeSnapshot, Protocol } from "./types";

dotenv.config();

async function saveSnapshots(database: Database) {
  const uniswapV2Indexer = new UniswapV2SubgraphIndexer(database);

  const balancerV2Indexer = new BalancerV2SubgraphIndexer(database);
  const uniswapV3Indexer = new UniswapV3SubgraphIndexer(database);
  const curveIndexer = new CurveIndexer(database);
  const dodoIndexer = new DodoIndexer(database);
  const indexers = [
    curveIndexer,
    dodoIndexer,
    balancerV2Indexer,
    uniswapV2Indexer,
    uniswapV3Indexer,
  ];
  const protocols = [
    Protocol.Curve,
    Protocol.DODO,
    Protocol.BalancerV2,
    Protocol.UniswapV2,
    Protocol.UniswapV3,
  ];
  for (let i = 0; i < indexers.length; ++i) {
    const indexer = indexers[i];
    logger.info(`processing indexer: ${Protocol[protocols[i]]}`);
    await indexer.processAllSnapshots();
  }
}

async function updatePoolWithLatestVolume(database: Database, dayId = "") {
  const protocols = [
    Protocol.Curve,
    Protocol.DODO,
    Protocol.DODOV2,
    Protocol.BalancerV2,
    Protocol.UniswapV2,
    Protocol.UniswapV3,
  ];
  for (let i = 0; i < protocols.length; ++i) {
    const protocol = protocols[i];
    logger.info(`processing indexer: ${Protocol[protocols[i]]}`);
    const snapshots: DailyVolumeSnapshot[] =
      await database.loadMany<DailyVolumeSnapshot>(
        { "pool.protocol": protocol, dayId: { $gt: dayId } },
        snapshotCollectionName
      );
    logger.info(`${snapshots.length} items of snapshots are found`);
    // get all pools using uniqby
    const pools = _(snapshots)
      .uniqBy((snapshot) => snapshot.pool.id)
      .map((snapshot) => snapshot.pool)
      .value();
    logger.info(`${pools.length} number of pools are found`);
    const poolsWithLatestVolume = _(pools)
      .map((pool) => {
        // for each pool, update its volumeUSD with latest daily snapshot.
        const latestSnapshot = _(snapshots)
          .filter((snapshot) => snapshot.pool.id === pool.id)
          .sortBy((snapshot) => snapshot.dayId)
          .last() as DailyVolumeSnapshot;
        return {
          ...pool,
          latestDailyVolumeUSD: latestSnapshot.volumeUSD,
          latestDayId: latestSnapshot.dayId,
        };
      })
      .value();
    logger.info(`updating pools with latest volumeUSD is done`);
    await database.saveMany(poolsWithLatestVolume, poolCollectionName);
  }
}

async function main() {
  const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`;
  // const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);

  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);

  await saveSnapshots(database);
  await updatePoolWithLatestVolume(database, "19000");

  // balancer pools
  const balancerIndexer = new BalancerSubgraphIndexer(database, provider);
  await balancerIndexer.processAllPools();

  await database.close();
}

main();
