export enum Protocol {
  UniswapV2,
  UniswapV3,
  Curve,
  CurveV2,
  Balancer,
  BalancerV2,
  Bancor,
  Kyber,
  DODO,
}

export type CommonToken = {
  address: string;
  symbol: string;
  decimals: number;
};

export type Token = {
  protocol: Protocol;
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
  derivedETH?: string;
  derivedUSD: string;
  timestamp?: string;
  block?: string;
};

export type Pool = {
  protocol: Protocol;
  id: string;
  tokens: string[];
  reserves: string[];
  reservesUSD?: string[];
  poolData?: unknown;
};

export type SwapEvent = {
  amount: string;
  fromToken: string;
  toToken: string;
  blockNumber: number;
};
