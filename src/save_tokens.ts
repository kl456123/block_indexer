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
import { Pool, Token } from "./types";

dotenv.config();

async function saveTokens(
  database: Database,
  provider: ethers.providers.JsonRpcProvider
) {
  const multicallContract = Multicall2__factory.connect(
    uniswapMulticallAddr,
    provider
  );

  const pools = await database.loadMany<Pool>({}, poolCollectionName);
  const tokens: string[] = _(pools)
    .flatMap((pool) => pool.tokens)
    .uniqBy((token) => token.toLowerCase())
    .value();
  logger.info(`num of tokens: ${tokens.length}`);
  const newTokens: Token[] = [];
  let num = 0;
  const callsForDecimals: Multicall2.CallStruct[] = [];
  const callsForSymbol: Multicall2.CallStruct[] = [];
  const callsForName: Multicall2.CallStruct[] = [];
  for (let i = 0; i < tokens.length; ++i) {
    const token = tokens[i];
    const tokenContract = IERC20Metadata__factory.connect(token, provider);
    // handle special cases first
    if (token.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
      newTokens.push({ symbol: "ETH", decimals: 18, address: token });
      continue;
    }
    if (token.toLowerCase() === "0xbb9bc244d798123fde783fcc1c72d3bb8c189413") {
      newTokens.push({ symbol: "TheDAO", decimals: 16, address: token });
      continue;
    }
    callsForDecimals.push({
      target: token,
      callData: tokenContract.interface.encodeFunctionData("decimals"),
    });
    callsForSymbol.push({
      target: token,
      callData: tokenContract.interface.encodeFunctionData("symbol"),
    });
    callsForName.push({
      target: token,
      callData: tokenContract.interface.encodeFunctionData("name"),
    });
    num += 1;
    if (num % 100 === 0 || i === tokens.length - 1) {
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
          encodedData.success
            ? encodedData.returnData.length === 66
              ? ethers.utils.parseBytes32String(encodedData.returnData)
              : encodedData.returnData.length === 2
              ? ""
              : tokenContract.interface.decodeFunctionResult(
                  "name",
                  encodedData.returnData
                )[0]
            : ""
        ) as unknown as string[];
        symbols = resultsForSymbol.map((encodedData) =>
          encodedData.success
            ? encodedData.returnData.length === 66
              ? ethers.utils.parseBytes32String(encodedData.returnData)
              : encodedData.returnData.length === 2
              ? ""
              : tokenContract.interface.decodeFunctionResult(
                  "symbol",
                  encodedData.returnData
                )[0]
            : ""
        ) as unknown as string[];
        decimals = resultsForDecimals.map((encodedData) =>
          encodedData.success
            ? encodedData.returnData.length === 2
              ? ""
              : tokenContract.interface.decodeFunctionResult(
                  "decimals",
                  encodedData.returnData
                )[0]
            : -1
        ) as unknown as number[];
      } catch (error: any) {
        logger.error(`args: ${error.args}, errorArgs: ${error.errorArgs}`);
      }
      // ignore self-destruct token contract
      const tokensChunk = names
        .map((name, ind) => ({
          symbol: symbols[ind],
          decimals: decimals[ind],
          address: callsForName[ind].target,
          name: names[ind],
        }))
        .filter(
          (token) =>
            token.symbol !== "" && token.name !== "" && token.decimals !== -1
        );
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

async function fetchSingleToken(
  addr: string,
  provider: ethers.providers.JsonRpcProvider
) {
  const multicallContract = Multicall2__factory.connect(
    uniswapMulticallAddr,
    provider
  );
  const tokenContract = IERC20Metadata__factory.connect(addr, provider);
  const callsForName = [];
  callsForName.push({
    target: addr,
    callData: tokenContract.interface.encodeFunctionData("name"),
  });
  const resultsForName = await multicallContract.callStatic.tryAggregate(
    false,
    callsForName
  );
  console.log(resultsForName);
}

async function main() {
  // const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`;
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);
  // await fetchSingleToken("0xbb9bc244d798123fde783fcc1c72d3bb8c189413", provider);
  const database = new Database(process.env.DB_CONN_STRING as string);
  await database.initDB(process.env.DB_NAME as string);
  await saveTokens(database, provider);
  await database.close();
}

main().catch(console.error);
