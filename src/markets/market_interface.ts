export interface MarketInterface {
  processAllPools(): Promise<void>;
  processAllSnapshots(): Promise<void>;
}
