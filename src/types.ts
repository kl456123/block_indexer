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

export interface PricingToken extends Token {
  protocol: Protocol;
  decimals: number;
  derivedETH?: string;
  derivedUSD: string;
  timestamp?: string;
  block?: string;
}

export interface Token {
  id: string;
  symbol: string;
  name?: string;
}

export interface Pool {
  protocol: Protocol;
  id: string;
  tokens: Token[];
  dailyVolumeUSD: string;
  poolData?: unknown;
}
