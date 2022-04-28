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

export interface PricingToken extends Token {
  protocol: Protocol;
  derivedETH?: string;
  derivedUSD: string;
  timestamp?: string;
  block?: string;
}

export interface Token {
  id: string;
  symbol: string;
  name?: string;
  decimals?: number;
}

export interface Pool {
  protocol: Protocol;
  id: string;
  tokens: Token[];
  poolData?: unknown;
}

export interface PoolWithVolume extends Pool {
  latestDailyVolumeUSD: string;
  latestDayId: string;
}

export interface DailyVolumeSnapshot {
  // normally speaking, id is composed pair address with dayid,
  // formally like '${pairAddress}-${dayId}'. In some special
  // cases like dodoex, its dailysnapshot id is just formally
  // like '${tokenAddress}-${tokenAddress}-${dayId}'
  id: string;
  volumeUSD: string;
  dayId: string;
  pool: Pool;
}

export type CollectionName = {
  pool: string;
  token: string;
  snapshot: string;
};
