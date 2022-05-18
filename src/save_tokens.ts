import * as dotenv from "dotenv";
import { ethers } from "ethers";
import _ from "lodash";

import {
  poolCollectionName,
  tokenCollectionName,
  uniswapMulticallAddr,
} from "./constants";
import { logger } from "./logging";
import { Database } from "./mongodb";
import {
  IERC20Metadata__factory,
  Multicall2,
  Multicall2__factory,
} from "./typechain";
import { PoolWithVolume, Token } from "./types";

dotenv.config();

async function saveTokens(
  database: Database,
  provider: ethers.providers.JsonRpcProvider
) {
  const multicallContract = Multicall2__factory.connect(
    uniswapMulticallAddr,
    provider
  );

  const pools = await database.loadMany<PoolWithVolume>({}, poolCollectionName);
  const tokens = _(pools)
    .flatMap((pool) => pool.tokens)
    .uniqBy((token) => token.id.toLowerCase())
    .value();
  console.log(tokens.length);
  const newTokens: Token[] = [];
  let num = 0;
  const callsForDecimals: Multicall2.CallStruct[] = [];
  const callsForSymbol: Multicall2.CallStruct[] = [];
  const callsForName: Multicall2.CallStruct[] = [];
  for (let i = 0; i < tokens.length; ++i) {
    const token = tokens[i];
    const tokenContract = IERC20Metadata__factory.connect(token.id, provider);
    if (
      token.id.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    ) {
      newTokens.push({ symbol: "ETH", decimals: 18, id: token.id });
      continue;
    }
    callsForDecimals.push({
      target: token.id,
      callData: tokenContract.interface.encodeFunctionData("decimals"),
    });
    callsForSymbol.push({
      target: token.id,
      callData: tokenContract.interface.encodeFunctionData("symbol"),
    });
    callsForName.push({
      target: token.id,
      callData: tokenContract.interface.encodeFunctionData("name"),
    });
    num += 1;
    if (num % 100 === 0 || i === tokens.length - 1) {
      // console.log(callsForDecimals.map(item=>item.target));
      const resultsForName = await multicallContract.callStatic.tryAggregate(
        false,
        callsForName
      );
      const resultsForDecimals =
        await multicallContract.callStatic.tryAggregate(
          false,
          callsForDecimals
        );
      const resultsForSymbol = await multicallContract.callStatic.tryAggregate(
        false,
        callsForSymbol
      );
      let names: string[] = [];
      let symbols: string[] = [];
      let decimals: number[] = [];
      try {
        names = resultsForName.map((encodedData) =>
          encodedData.returnData.length === 66
            ? ethers.utils.parseBytes32String(encodedData.returnData)
            : encodedData.returnData.length === 2
            ? ""
            : tokenContract.interface.decodeFunctionResult(
                "name",
                encodedData.returnData
              )
        ) as unknown as string[];
        symbols = resultsForSymbol.map((encodedData) =>
          encodedData.returnData.length === 66
            ? ethers.utils.parseBytes32String(encodedData.returnData)
            : encodedData.returnData.length === 2
            ? ""
            : tokenContract.interface.decodeFunctionResult(
                "symbol",
                encodedData.returnData
              )
        ) as unknown as string[];
        decimals = resultsForDecimals.map((encodedData) =>
          encodedData.success
            ? tokenContract.interface.decodeFunctionResult(
                "decimals",
                encodedData.returnData
              )
            : 0
        ) as unknown as number[];
      } catch (error: any) {
        console.log("args: ", error.args, " errorArgs: ", error.errorArgs);
      }
      // ignore self-destruct token contract
      const tokensChunk = names
        .map((name, ind) => ({
          symbol: symbols[ind],
          decimals: decimals[ind],
          id: callsForName[ind].target,
          name: names[ind],
        }))
        .filter((token) => token.symbol !== "");
      newTokens.push(...tokensChunk);

      // empty calls array
      callsForDecimals.length = 0;
      callsForName.length = 0;
      callsForSymbol.length = 0;
      logger.info(`processing ${num}th tokens`);
    }
  }
  await database.saveMany(newTokens, tokenCollectionName);
}

async function main() {
  // const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`;
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);
  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);
  await saveTokens(database, provider);
  await database.close();
}

main().catch(console.error);
