import fs from "fs";
import { BigNumber } from "bignumber.js";
import * as dotenv from "dotenv";
import { BigNumber as EthersBigNumber, ethers } from "ethers";
import { TokenPricing } from "./pricing";
import { tokens } from "./tokens";
import {
  UniswapV2Pair__factory,
  UniswapV3Pool__factory,
  DODO__factory,
} from "./typechain";
import { CommonToken, SwapEvent, Protocol } from "./types";
dotenv.config();

function toBN(num: EthersBigNumber) {
  return new BigNumber(num.toString());
}

async function handleUniswapV2SwapEvents(
  pairAddr: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider
) {
  const pairContract = UniswapV2Pair__factory.connect(pairAddr, provider);
  const filter = pairContract.filters.Swap();
  const exchangeLogs = await pairContract.queryFilter(filter, fromBlock);
  const token0 = await pairContract.token0();
  const token1 = await pairContract.token1();
  console.log(`num of swap events in uniswapv2: ${exchangeLogs.length}`);

  const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
    const args = log.args!;
    const { sender, amount0In, amount0Out, amount1In, amount1Out } = args;
    const fromToken = amount0In.gt(0) ? token0 : token1;
    const toToken = amount1Out.gt(0) ? token1 : token0;
    const amountIn = amount0In.gt(0) ? amount0In : amount1In;
    const amountOut = amount0Out.gt(0) ? amount0Out : amount1Out;
    return {
      fromToken,
      toToken,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      blockNumber: log.blockNumber,
      protocol: Protocol.UniswapV2,
      address: log.address,
    };
  });
  return swapEvents;
}

function calcVolumeUSD(swapEvents: SwapEvent[], tokenPricing: TokenPricing) {
  console.log(`num of swap events: ${swapEvents.length}`);
  const totalVolumeUSD = swapEvents
    .sort((a, b) => a.blockNumber - b.blockNumber)
    .map(
      ({
        fromToken,
        toToken,
        amountIn,
        amountOut,
        blockNumber,
        address,
        protocol,
      }) => {
        if (fromToken === toToken) {
          return new BigNumber(0);
        }
        const volumeUSD = tokenPricing.volumeInUSD(
          fromToken,
          amountIn.toString(),
          toToken,
          amountOut.toString(),
          blockNumber,
          address,
          protocol
        );
        return volumeUSD;
      }
    )

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
      const { sold_id, tokens_sold, bought_id, tokens_bought } = args;
      const fromToken = pool.tokens[sold_id];
      const toToken = pool.tokens[bought_id];
      const volumeUSD = tokenPricing.volumeInUSD(
        fromToken,
        tokens_sold.toString(),
        toToken,
        tokens_bought.toString(),
        log.blockNumber,
        log.address,
        Protocol.Curve
      );
      return volumeUSD;
    })
    .reduce((res, cur) => {
      return res.plus(cur);
    }, new BigNumber(0));
  return totalVolumeUSD;
}

async function handleBalancerV2SwapEvents(
  address: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider
) {
  const abi = [
    "event Swap(bytes32 indexed poolId,address indexed tokenIn,address indexed tokenOut,uint256 amountIn,uint256 amountOut)",
  ];
  const vault = new ethers.Contract(address, abi, provider);
  const filter = vault.filters.Swap(
    null,
    tokens.WETH.address,
    tokens.USDC.address
  );
  const exchangeLogs = await vault.queryFilter(filter, fromBlock);
  console.log(`num of swap events in balancerV2: ${exchangeLogs.length}`);
  const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
    const { poolId, tokenIn, tokenOut, amountIn, amountOut } = log.args!;
    return {
      fromToken: tokenIn,
      toToken: tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      blockNumber: log.blockNumber,
      address: poolId, // not address
      protocol: Protocol.BalancerV2,
    };
  });
  return swapEvents;
}

async function handleUniswapV3SwapEvents(
  poolAddr: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider
) {
  const pairContract = UniswapV3Pool__factory.connect(poolAddr, provider);
  const filter = pairContract.filters.Swap();
  const exchangeLogs = await pairContract.queryFilter(filter, fromBlock);
  const token0 = await pairContract.token0();
  const token1 = await pairContract.token1();
  console.log(`num of swap events in uniswapV3: ${exchangeLogs.length}`);

  const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
    const { amount0, amount1 } = log.args;
    const fromToken = amount0.gt(0) ? token0 : token1;
    const toToken = amount0.lt(0) ? token0 : token1;
    const amountIn = amount0.gt(0) ? amount0 : amount1;
    const amountOut = amount0.lt(0) ? amount0 : amount1;
    return {
      fromToken,
      toToken,
      amountIn: amountIn.toString(),
      amountOut: amountOut.abs().toString(),
      blockNumber: log.blockNumber,
      address: log.address,
      protocol: Protocol.UniswapV3,
    };
  });
  return swapEvents;
}

async function handleBalancerSwapEvents(
  address: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider
) {
  const abi = [
    "event LOG_SWAP(address indexed caller, address indexed tokenIn, address indexed tokenOut, uint256 tokenAmountIn, uint256 tokenAmountOut)",
  ];
  const vault = new ethers.Contract(address, abi, provider);
  const filter = vault.filters.LOG_SWAP(
    null,
    tokens.USDC.address,
    tokens.WETH.address
  );
  const exchangeLogs = await vault.queryFilter(filter, fromBlock);
  console.log(`num of swap events in balancer: ${exchangeLogs.length}`);
  const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
    const { tokenIn, tokenOut, tokenAmountIn, tokenAmountOut } = log.args!;
    return {
      fromToken: tokenIn,
      toToken: tokenOut,
      amountIn: tokenAmountIn.toString(),
      amountOut: tokenAmountOut.toString(),
      blockNumber: log.blockNumber,
      address: log.address,
      protocol: Protocol.Balancer,
    };
  });
  return swapEvents;
}

async function handleDODOSwapEvents(
  address: string,
  fromBlock: number,
  provider: ethers.providers.JsonRpcProvider
) {
  const dodoPool = DODO__factory.connect(address, provider);
  const baseToken = await dodoPool._BASE_TOKEN_();
  const quoteToken = await dodoPool._QUOTE_TOKEN_();

  const buyBaseFilter = dodoPool.filters.BuyBaseToken();
  const buyBaseLogs = await dodoPool.queryFilter(buyBaseFilter, fromBlock);

  const sellBaseFilter = dodoPool.filters.SellBaseToken();
  const sellBaseLogs = await dodoPool.queryFilter(sellBaseFilter, fromBlock);
  // const exchangeLogs = [...buyBaseLogs, ...sellBaseLogs];
  console.log(
    `num of swap events in dodo: ${buyBaseLogs.length + sellBaseLogs.length}`
  );

  const buyBaseEvents: SwapEvent[] = buyBaseLogs.map((log) => {
    const { receiveBase, payQuote } = log.args;
    return {
      fromToken: quoteToken,
      toToken: baseToken,
      amountIn: payQuote.toString(),
      amountOut: receiveBase.toString(),
      blockNumber: log.blockNumber,
      address: log.address,
      protocol: Protocol.DODO,
    };
  });

  const sellBaseEvents: SwapEvent[] = sellBaseLogs.map((log) => {
    const { receiveQuote, payBase } = log.args;
    return {
      fromToken: baseToken,
      toToken: quoteToken,
      amountIn: payBase.toString(),
      amountOut: receiveQuote.toString(),
      blockNumber: log.blockNumber,
      address: log.address,
      protocol: Protocol.DODO,
    };
  });

  const swapEvents = [...sellBaseEvents, ...buyBaseEvents];

  return swapEvents;
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
  // const curveAddress = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"; // 3pool
  // const curveVolumeUSDInDay = await calcVolumeUSDInCurve(curveAddress, fromBlock, provider, tokenPricing);
  // console.log(`curve total volume in usd: ${curveVolumeUSDInDay.toString()}`);

  // balancerv2
  const vaultAddr = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const balancerV2SwapEvents = await handleBalancerV2SwapEvents(
    vaultAddr,
    fromBlock,
    provider
  );

  // balancer
  const bpoolAddr = "0xE7ce624C00381b4b7aBB03e633fB4aCaC4537dD6";
  const balancerSwapEvents = await handleBalancerSwapEvents(
    bpoolAddr,
    fromBlock,
    provider
  );

  // uniswapv2
  const weth_usdc_pairAddr = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
  const uniswapV2SwapEvents = await handleUniswapV2SwapEvents(
    weth_usdc_pairAddr,
    fromBlock,
    provider
  );

  // uniswapv3
  const weth_usdc_500 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
  const uniswapV3SwapEvents = await handleUniswapV3SwapEvents(
    weth_usdc_500,
    fromBlock,
    provider
  );

  // const weth_usdc_dodo = '0x75c23271661d9d143DCb617222BC4BEc783eff34';
  // const dodoSwapEvents = await handleDODOSwapEvents(weth_usdc_dodo, fromBlock, provider);

  const totalSwapEvents = [
    ...balancerSwapEvents,
    ...balancerV2SwapEvents,
    ...uniswapV2SwapEvents,
    ...uniswapV3SwapEvents,
  ];
  const volumeUSDInDay = calcVolumeUSD(totalSwapEvents, tokenPricing);

  console.log(`total volume in usd: ${volumeUSDInDay.toString()}`);

  // const wyvernExchangeV2Addr = "0x7f268357A8c2552623316e2562D90e642bB538E5";

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
