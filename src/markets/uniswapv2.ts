import {
  UniswapV2Factory__factory,
  UniswapV2Pair__factory,
  UniswapV2Factory,
} from "../typechain";
import { logger } from "../logging";
import retry from "async-retry";
import { ethers } from "ethers";
import { Token, Pool, Protocol } from "../types";
import { Database } from "../mongodb";

export class UniswapV2Indexer {
  protected factoryContract: UniswapV2Factory;
  protected retries: number;
  protected chunkSize: number;
  constructor(
    protected provider: ethers.providers.BaseProvider,
    protected database: Database,
    factoryAddr: string,
    protected collectionName = "pools"
  ) {
    this.factoryContract = UniswapV2Factory__factory.connect(
      factoryAddr,
      provider
    );
    this.retries = 3;
    this.chunkSize = 40;
  }

  public async processSingle(i: number, save = true) {
    const poolAddr = await this.factoryContract.allPairs(i);
    const poolContract = UniswapV2Pair__factory.connect(
      poolAddr,
      this.provider
    );
    const [{ _reserve0, _reserve1 }, token0, token1] = await Promise.all([
      poolContract.getReserves(),
      poolContract.token0(),
      poolContract.token1(),
    ]);
    const reserve0 = _reserve0.toString();
    const reserve1 = _reserve1.toString();
    const pool: Pool = {
      id: poolAddr,
      protocol: Protocol.UniswapV2,
      reserves: [reserve0, reserve1],
      reservesUSD: ["0", "0"],
      tokens: [token0, token1],
    };
    if (save) {
      await this.database.save(pool, this.collectionName);
    }
    return pool;
  }

  public async processAll(start = 0, save = true) {
    const allPairsLength = (
      await this.factoryContract.allPairsLength()
    ).toNumber();
    logger.info(`total number of pairs: ${allPairsLength}`);
    const calls: Promise<Pool>[] = [];
    const allPools = [];
    for (let i = start; i < allPairsLength; ++i) {
      calls.push(this.processSingle.bind(this)(i, false));
      if (calls.length % this.chunkSize === 0) {
        let pools: Pool[] = [];
        try {
          await retry(
            async () => {
              pools = await Promise.all(calls);
            },
            {
              retries: this.retries,
              onRetry: (err, retry) => {
                logger.warn(
                  `Failed request for page of pools from onchain due to ${err}. Retry attempt: ${retry}`
                );
                // reset
                pools = [];
              },
            }
          );
        } catch {
          logger.error(`skip index from ${i - this.chunkSize + 1}th -${i}th`);
          continue;
        }
        if (save) {
          await this.database.saveMany(pools, this.collectionName);
        }
        allPools.push(...pools);
        calls.length = 0;
        logger.info(`processing the ${i + 1}th new pool`);
      }
    }
    return allPools;
  }
}
