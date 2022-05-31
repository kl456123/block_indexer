import { BigNumber } from "bignumber.js";
import { ethers } from "ethers";
import { PRICING_ASSETS, tokens, USD_STABLE_ASSETS } from "./tokens";
import { CommonToken } from "./types";

type TokenMap = {
  [name: string]: CommonToken;
};

const Zero = new BigNumber(0);
const One = new BigNumber(1);

type PriceWithVolume = {
  price: BigNumber;
  volume: BigNumber;
};

export type HistoryPriceWithVolume = PriceWithVolume & {
  blockNumber: number;
};

export class TokenPricing {
  // params
  protected pricingAssets: string[];
  protected usdStableAssets: string[];
  protected priceDecimals: number;
  // protected tick: number;

  // internal states
  // mapping from ${baseToken}-${quoteToken} to price
  private usdPrice: Record<string, BigNumber>;
  private tokenPrice: Record<string, PriceWithVolume[]>;
  protected startBlockNumber: number;
  protected historyUSDPrice: Record<string, HistoryPriceWithVolume[]>;

  constructor(
    protected tick: number = 2,
    protected tokens: TokenMap,
    protected provider: ethers.providers.JsonRpcProvider,
  ) {
    this.pricingAssets = PRICING_ASSETS.map((asset) =>
      asset.address.toLowerCase()
    );
    this.usdStableAssets = USD_STABLE_ASSETS.map((asset) =>
      asset.address.toLowerCase()
    );
    this.usdPrice = {};
    this.tokenPrice = {};
    this.historyUSDPrice = {};
    this.priceDecimals = 8;
    this.startBlockNumber = 0;
  }

  public getHistoryUSDPrice(token: string) {
    return this.historyUSDPrice[token.toLowerCase()].map((priceWithVolume) => ({
      price: priceWithVolume.price.dp(this.priceDecimals),
      volume: priceWithVolume.volume.dp(this.priceDecimals),
      blockNumber: priceWithVolume.blockNumber,
    }));
  }

  public async initPricingAsset() {
    this.usdPrice[tokens.USDC.address.toLowerCase()] = One;
    this.usdPrice[tokens.USDT.address.toLowerCase()] = One;
    this.usdPrice[tokens.DAI.address.toLowerCase()] = One;
  }

  public isUSDStable(token: string) {
    return this.usdStableAssets.some(
      (asset) => asset.toLowerCase() === token.toLowerCase()
    );
  }

  public getTokenPairKey(baseToken: string, quoteToken: string) {
    return `${baseToken.toLowerCase()}-${quoteToken.toLowerCase()}`;
  }

  public getLatestPriceInUSD(baseToken: string) {
    for (let i = 0; i < this.pricingAssets.length; ++i) {
      const key = this.getTokenPairKey(baseToken, this.pricingAssets[i]);
      if (Object.keys(this.tokenPrice).includes(key)) {
        const totalVolume = this.tokenPrice[key].reduce(
          (res, cur) => res.plus(cur.volume),
          Zero
        );
        let usdPrice;
        // price of stable coin is always stable.
        if (this.isUSDStable(baseToken)) {
          usdPrice = One;
        }else{
            const averagePrice = this.tokenPrice[key]
          .reduce((res, cur) => res.plus(cur.price.times(cur.volume)), Zero)
          .div(totalVolume);
            usdPrice = averagePrice.times(
          this.usdPrice[this.pricingAssets[i]] ?? Zero
        );
        }
        this.usdPrice[baseToken.toLowerCase()] = usdPrice;
        return {
          price: usdPrice.dp(this.priceDecimals),
          volume: totalVolume.dp(this.priceDecimals),
        };
      }
    }
    return { price: Zero, volume: Zero };
  }

  public getDecimals(tokenAddr: string) {
    const token = this.tokens[tokenAddr.toLowerCase()];
    if (!token) {
      throw new Error(`unsupported token: ${tokenAddr}`);
    }
    return new BigNumber(10).pow(token.decimals);
  }

  public isExpire(newTimestamp: number) {
    return newTimestamp > this.startBlockNumber + this.tick;
  }

  public volumeInUSD(
    fromToken: string,
    fromTokenAmount: BigNumber,
    toToken: string,
    toTokenAmount: BigNumber,
    timeStamp: number
  ) {
    // to lowercase
    const fromTokenAddr = fromToken.toLowerCase();
    const toTokenAddr = toToken.toLowerCase();

    const { price: fromTokenPrice, volume: fromTokenVolume } =
      this.getLatestPriceInUSD(fromTokenAddr);
    const { price: toTokenPrice, volume: toTokenVolume } =
      this.getLatestPriceInUSD(toTokenAddr);
    const amountSold = fromTokenAmount.div(this.getDecimals(fromTokenAddr));
    const amountBought = toTokenAmount.div(this.getDecimals(toTokenAddr));
    let volume = new BigNumber(0);
    // only pricing assets are considered
    if (
      this.pricingAssets.includes(fromTokenAddr) &&
      this.pricingAssets.includes(toTokenAddr)
    ) {
      volume = amountSold
        .times(fromTokenPrice)
        .plus(amountBought.times(toTokenPrice))
        .div(2);
    } else if (this.pricingAssets.includes(fromTokenAddr)) {
      volume = amountSold.times(fromTokenPrice);
    } else if (this.pricingAssets.includes(toTokenAddr)) {
      volume = amountBought.times(toTokenPrice);
    }
    // update token pair price
    const newToTokenPrice = amountSold.div(amountBought);
    const newFromTokenPrice = amountBought.div(amountSold);

    if (timeStamp >= this.startBlockNumber + this.tick) {
      // cache history token price
      const fromTokenHistory = this.historyUSDPrice[fromTokenAddr] ?? [];
      const toTokenHistory = this.historyUSDPrice[toTokenAddr] ?? [];
      fromTokenHistory.push({
        price: fromTokenPrice,
        volume: fromTokenVolume,
        blockNumber: this.startBlockNumber,
      });
      toTokenHistory.push({
        price: toTokenPrice,
        volume: toTokenVolume,
        blockNumber: this.startBlockNumber,
      });
      this.historyUSDPrice[fromTokenAddr] = fromTokenHistory;
      this.historyUSDPrice[toTokenAddr] = toTokenHistory;
      // start next round
      this.tokenPrice[this.getTokenPairKey(toTokenAddr, fromTokenAddr)] = [
        { price: newToTokenPrice, volume: amountBought },
      ];
      this.tokenPrice[this.getTokenPairKey(fromTokenAddr, toTokenAddr)] = [
        { price: newFromTokenPrice, volume: amountSold },
      ];

      // update block number
      const num = Math.floor((timeStamp - this.startBlockNumber) / this.tick);
      // fast-forward
      this.startBlockNumber += this.tick * num;
    } else if (
      timeStamp < this.startBlockNumber + this.tick &&
      timeStamp >= this.startBlockNumber
    ) {
      /// push price to the current round
      this.tokenPrice[this.getTokenPairKey(toTokenAddr, fromTokenAddr)].push({
        price: newToTokenPrice,
        volume: amountBought,
      });
      this.tokenPrice[this.getTokenPairKey(fromTokenAddr, toTokenAddr)].push({
        price: newFromTokenPrice,
        volume: amountSold,
      });
    }

    return volume.dp(this.priceDecimals);
  }
}
