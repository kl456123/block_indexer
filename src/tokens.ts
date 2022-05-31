import { CommonToken } from "./types";

const WETH: CommonToken = {
  address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  symbol: "WETH",
  decimals: 18,
};

const WBTC: CommonToken = {
  address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  symbol: "WBTC",
  decimals: 8,
};

const USDC: CommonToken = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  decimals: 6,
};

const DAI: CommonToken = {
  symbol: "DAI",
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  decimals: 18,
};

const USDT: CommonToken = {
  symbol: "USDT",
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  decimals: 6,
};

export const PRICING_ASSETS: CommonToken[] = [WETH, WBTC, USDC, DAI, USDT];

export const USD_STABLE_ASSETS: CommonToken[] = [USDC, DAI, USDT];

export const tokens = {
  WETH,
  WBTC,
  USDC,
  DAI,
  USDT,
};
