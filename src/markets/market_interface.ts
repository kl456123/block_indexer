export interface MarketInterface {
  processAllTokens(): Promise<void>;
  processAllPools(): Promise<void>;
}
