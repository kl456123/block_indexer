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
  DODOV2,
}

export type CommonToken = {
  address: string;
  symbol: string;
  decimals: number;
};

export type Token = {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
};

export type Pool = {
  protocol: Protocol;
  id: string;
  tokens: string[];
  liquidity: string[];
  poolData?: unknown;
};

export type SwapEvent = {
  amountIn: string;
  amountOut: string;
  fromToken: string;
  toToken: string;
  blockNumber: number;
  protocol: Protocol;
  address: string;
};
