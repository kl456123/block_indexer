import fs from "fs";
import { BigNumber } from "bignumber.js";
import * as dotenv from "dotenv";
import { BigNumber as EthersBigNumber, ethers } from "ethers";
import { TokenPricing } from "./pricing";
import { tokens } from "./tokens";
import { UniswapV2Pair__factory } from "./typechain";
import { CommonToken } from "./types";
dotenv.config();

function toBN(num: EthersBigNumber) {
  return new BigNumber(num.toString());
}

async function calcVolumeUSDInUniswapV2(
  pairAddr: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider,
  tokenPricing: TokenPricing
) {
  const pairContract = UniswapV2Pair__factory.connect(pairAddr, provider);
  const filter = pairContract.filters.Swap();
  const exchangeLogs = await pairContract.queryFilter(filter, fromBlock);
  const token0 = await pairContract.token0();
  const token1 = await pairContract.token1();
  console.log(`num of swap txns: ${exchangeLogs.length}`);

  const totalVolumeUSD = exchangeLogs
    .sort((a, b) => a.blockNumber - b.blockNumber)
    .map((log) => {
      const args = log.args!;
      const { sender, amount0In, amount0Out, amount1In, amount1Out } = args;
      const fromToken = amount0In.gt(0) ? token0 : token1;
      const toToken = amount1Out.gt(0) ? token1 : token0;
      const tokensSold = amount0In.gt(0) ? amount0In : amount1In;
      const tokensBought = amount0Out.gt(0) ? amount0Out : amount1Out;
      const volumeUSD = tokenPricing.volumeInUSD(
        fromToken,
        toBN(tokensSold),
        toToken,
        toBN(tokensBought),
        log.blockNumber
      );
      return volumeUSD;
    })
    .reduce((res, cur) => res.plus(cur), new BigNumber(0));
  return totalVolumeUSD;
}

async function calcVolumeUSDInCurve(
  address: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider,
  tokenPricing: TokenPricing
) {
  const abi = [
    "event TokenExchange(address indexed buyer,int128 sold_id,uint256 tokens_sold,int128 bought_id,uint256 tokens_bought)",
  ];
  const curvePoolContract = new ethers.Contract(address, abi, provider);
  const filter = curvePoolContract.filters.TokenExchange();
  const exchangeLogs = await curvePoolContract.queryFilter(filter, fromBlock);
  const pool = {
    id: "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
    tokens: [
      "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    ],
    poolData: {
      isMeta: false,
      isLending: false,
      wrappedToken: null,
    },
  };
  console.log(`num of swap txns: ${exchangeLogs.length}`);
  const totalVolumeUSD = exchangeLogs
    .map((log) => {
      const args = log.args!;
      const { buyer, sold_id, tokens_sold, bought_id, tokens_bought } = args;
      const fromToken = pool.tokens[sold_id];
      const toToken = pool.tokens[bought_id];
      const volumeUSD = tokenPricing.volumeInUSD(
        fromToken,
        toBN(tokens_sold),
        toToken,
        toBN(tokens_bought),
        log.blockNumber
      );
      return volumeUSD;
    })
    .reduce((res, cur) => {
      return res.plus(cur);
    }, new BigNumber(0));
  return totalVolumeUSD;
}

function listenExchangeOnCurve(
  address: string,
  provider: ethers.providers.JsonRpcProvider
) {
  const abi = [
    "event TokenExchange(address indexed buyer,int128 sold_id,uint256 tokens_sold,int128 bought_id,uint256 tokens_bought)",
  ];
  const curvePoolContract = new ethers.Contract(address, abi, provider);
  const filter = curvePoolContract.filters.TokenExchange();
  curvePoolContract.on(filter, (buyer, sold_id, tokens_sold) => {
    console.log(buyer);
  });
  return curvePoolContract;
}

function listenExchangeOnUniswapV2(
  pairAddr: string,
  provider: ethers.providers.JsonRpcProvider
) {
  const pairContract = UniswapV2Pair__factory.connect(pairAddr, provider);
  const filter = pairContract.filters.Swap();
  pairContract.on(filter, (...args) => {
    console.log(args);
  });
}

function listenExchangeOnOpensea(
  wyvernExchangeV2Addr: string,
  provider: ethers.providers.JsonRpcProvider
) {
  // subscribe opensea
  const wyvernExchangeV2Abi = [
    "event OrdersMatched(bytes32 buyHash, bytes32 sellHash, address indexed maker, address indexed taker, uint price, bytes32 indexed metadata)",
  ];
  const wyvernExchangeContract = new ethers.Contract(
    wyvernExchangeV2Addr,
    wyvernExchangeV2Abi,
    provider
  );
  wyvernExchangeContract.on(
    "OrdersMatched",
    (buyHash, sellHash, maker, taker, price, metadata) => {
      console.log(taker);
    }
  );
}

async function getLogs(
  address: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider
) {
  // getLogs api
  const topics = [
    ethers.utils.id("TokenExchange(address,int128,uint256,int128,uint256)"),
  ];
  const logs = await provider.getLogs({ fromBlock, address, topics });
  console.log(logs.length);
  const abiCoder = ethers.utils.defaultAbiCoder;
  const res = abiCoder.decode(
    ["int128", "uint256", "int128", "uint256"],
    logs[0].data
  );
  console.log(res.map((value) => value.toString()));
}

async function main() {
  // const url = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`;
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);
  const currentBlockNumber = await provider.getBlockNumber();
  const DAY = 86400;
  const blockNumberPerDay = Math.round(DAY / 13);
  const fromBlock = currentBlockNumber - blockNumberPerDay;

  // contract api
  const tokensMap: Record<string, CommonToken> = {};
  Object.values(tokens).forEach((token) => {
    tokensMap[token.address.toLowerCase()] = token;
  });
  const tick = 20;
  const tokenPricing = new TokenPricing(tick, tokensMap, provider);
  await tokenPricing.initPricingAsset();

  // curve
  const curveAddress = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"; // 3pool
  // const curveVolumeUSDInDay = await calcVolumeUSDInCurve(curveAddress, fromBlock, provider, tokenPricing);
  // console.log(`curve total volume in usd: ${curveVolumeUSDInDay.toString()}`);

  // // uniswapv2 pair
  const weth_usdc_pairAddr = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
  const uniswapV2VolumeUSDInDay = await calcVolumeUSDInUniswapV2(
    weth_usdc_pairAddr,
    fromBlock,
    provider,
    tokenPricing
  );
  console.log(
    `uniswapv2 total volume in usd: ${uniswapV2VolumeUSDInDay.toString()}`
  );

  const wyvernExchangeV2Addr = "0x7f268357A8c2552623316e2562D90e642bB538E5";

  console.log(
    tokenPricing.getLatestPriceInUSD(tokens.WETH.address).price.toNumber()
  );
  const historyUSDPrice = tokenPricing.getHistoryUSDPrice(tokens.WETH.address);
  console.log(`num of data points: ${historyUSDPrice.length}`);
  // ignore the first one
  fs.writeFileSync(
    "./price.json",
    JSON.stringify(
      historyUSDPrice
        .slice(1)
        .map((item) => ({ ...item, price: item.price.toNumber() })),
      null,

      4
    )
  );

  // listenExchangeOnCurve(curveAddress, provider);
  // listenExchangeOnUniswapV2(weth_usdc_pairAddr, provider);
  // listenExchangeOnOpensea(wyvernExchangeV2Addr, provider);
}

main().catch(console.error);
