export type CommonToken = {
  address: string;
  symbol: string;
};

const WETH: CommonToken = {
  address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  symbol: "WETH",
};

const WBTC: CommonToken = {
  address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  symbol: "WBTC",
};

const USDC: CommonToken = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
};

const DAI: CommonToken = {
  symbol: "DAI",
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
};

const USDT: CommonToken = {
  symbol: "USDT",
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
};

const BAL: CommonToken = {
  symbol: "BAL",
  address: "0xba100000625a3754423978a60c9317c58a424e3D",
};

const LINEAR_DAI: CommonToken = {
  symbol: "LINEAR_DAI",
  address: "0x804CdB9116a10bB78768D3252355a1b18067bF8f",
};

const LINEAR_USDC: CommonToken = {
  symbol: "LINEAR_USDC",
  address: "0x9210F1204b5a24742Eba12f710636D76240dF3d0",
};

const LINEAR_USDT: CommonToken = {
  symbol: "LINEAR_USDT",
  address: "0x2BBf681cC4eb09218BEe85EA2a5d3D13Fa40fC0C",
};

export const PRICING_ASSETS: CommonToken[] = [
  WETH,
  WBTC,
  USDC,
  DAI,
  USDT,
  BAL,
  LINEAR_DAI,
  LINEAR_USDC,
  LINEAR_USDT,
];

export const USD_STABLE_ASSETS: CommonToken[] = [USDC, DAI, USDT];
