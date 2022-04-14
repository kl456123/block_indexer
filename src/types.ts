export enum Protocol {
  UniswapV2,
  UniswapV3,
  Curve,
  CurveV2,
  Balancer,
  BalancerV2,
  Bancor,
  Kyber,
}

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
  reserves: string[];
  reservesUSD: string[];
  poolData?: unknown;
};
