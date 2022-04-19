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
