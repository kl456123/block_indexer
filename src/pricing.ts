import { BigNumber } from "bignumber.js";
import { ethers } from "ethers";
import { PRICING_ASSETS, tokens, USD_STABLE_ASSETS } from "./tokens";
import { CommonToken, Protocol } from "./types";
import { day, secondsPerBlock } from "./constants";
import { logger } from "./logging";
import _ from "lodash";

type TokenMap = {
  [name: string]: CommonToken;
};

const Zero = new BigNumber(0);
const One = new BigNumber(1);

type PriceWithVolume = {
  price: BigNumber;
  volume: BigNumber;
};

type DataSource = {
  protocol: Protocol;
  address: string;
};

export type HistoryPriceWithVolume = PriceWithVolume & {
  blockNumber: number;
};

export type TokenPriceWithSource = PriceWithVolume & DataSource;

export class TokenPricing {
  // params
  protected pricingAssets: string[];
  protected usdStableAssets: string[];
  protected priceDecimals: number;
  protected maxHistoryRecords: number;

  // internal states
  // mapping from ${baseToken}-${quoteToken} to price
  private usdPrice: Record<string, BigNumber>;
  private tokenPrice: Record<string, TokenPriceWithSource[]>;
  protected startBlockNumber: number;
  protected numRounds: number;
  protected historyUSDPrice: Record<string, HistoryPriceWithVolume[]>;

  constructor(
    protected tick: number = 2,
    protected tokens: TokenMap,
    protected provider: ethers.providers.JsonRpcProvider
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
    this.numRounds = 0;
    this.startBlockNumber = 0;
    this.maxHistoryRecords = (2 * day) / 13 / this.tick;

    this.initPricingAsset();
  }

  public getHistoryUSDPrice(token: string): HistoryPriceWithVolume[] {
    if (token.toLowerCase() in this.historyUSDPrice) {
      return this.historyUSDPrice[token.toLowerCase()].map(
        (priceWithVolume) => ({
          price: priceWithVolume.price.dp(this.priceDecimals),
          volume: priceWithVolume.volume.dp(this.priceDecimals),
          blockNumber: priceWithVolume.blockNumber,
        })
      );
    }
    return [];
  }

  public initPricingAsset() {
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

  private processTokenPrice(
    tokenPrices: TokenPriceWithSource[],
    baseToken: string,
    quoteToken: string
  ): {
    round: number;
    price: BigNumber;
    volume: BigNumber;
    priceWithVolumePerPool: {
      price: BigNumber;
      volume: BigNumber;
      address: string;
      protocol: Protocol;
    }[];
  } {
    const quoteTokenPriceInUSD = this.usdPrice[quoteToken] ?? Zero;
    const priceWithVolumePerPool = _(tokenPrices)
      .map((item) => item.address)
      .uniq()
      .map((address) =>
        tokenPrices.filter((tokenPrice) => tokenPrice.address === address)
      )
      .map((tokenPricesPerPool) =>
        tokenPricesPerPool.reduce(
          (res, cur) => {
            return {
              ...res,
              value: res.value.plus(cur.price.times(cur.volume)),
              volume: res.volume.plus(cur.volume),
            };
          },
          {
            volume: Zero,
            value: Zero,
            address: tokenPricesPerPool[0].address,
            protocol: tokenPricesPerPool[0].protocol,
          }
        )
      )
      .map((tokenPricePerPool) => {
        const price = tokenPricePerPool.value
          .div(tokenPricePerPool.volume)
          .times(quoteTokenPriceInUSD)
          .dp(this.priceDecimals);
        return {
          price,
          volume: tokenPricePerPool.volume.dp(this.priceDecimals),
          address: tokenPricePerPool.address,
          protocol: tokenPricePerPool.protocol,
        };
      })
      .value();

    // volume and weighted average price
    const totalVolume = tokenPrices.reduce(
      (res, cur) => res.plus(cur.volume),
      Zero
    );
    const usdPrice = this.isUSDStable(baseToken)
      ? One
      : tokenPrices
          .reduce((res, cur) => res.plus(cur.price.times(cur.volume)), Zero)
          .div(totalVolume)
          .times(quoteTokenPriceInUSD);
    return {
      round: this.numRounds,
      price: usdPrice.dp(this.priceDecimals),
      volume: totalVolume.dp(this.priceDecimals),
      priceWithVolumePerPool,
    };
  }

  public getLatestPriceInUSD(baseToken: string) {
    for (let i = 0; i < this.pricingAssets.length; ++i) {
      const key = this.getTokenPairKey(baseToken, this.pricingAssets[i]);
      if (key in this.tokenPrice) {
        return this.processTokenPrice(
          this.tokenPrice[key],
          baseToken,
          this.pricingAssets[i]
        );
      }
    }
    return {
      round: this.numRounds,
      price: Zero,
      volume: Zero,
      priceWithVolumePerPool: [],
    };
  }

  public getDecimals(tokenAddr: string) {
    const token = this.tokens[tokenAddr.toLowerCase()];
    if (!token) {
      throw new Error(`unsupported token: ${tokenAddr}`);
    }
    return new BigNumber(10).pow(token.decimals);
  }

  public volumeInUSD(
    fromToken: string,
    fromTokenAmount: string,
    toToken: string,
    toTokenAmount: string,
    blockNumber: number,
    address: string,
    protocol: Protocol
  ) {
    // to lowercase
    const fromTokenAddr = fromToken.toLowerCase();
    const toTokenAddr = toToken.toLowerCase();

    const { price: fromTokenPrice, volume: fromTokenVolume } =
      this.getLatestPriceInUSD(fromTokenAddr);
    const { price: toTokenPrice, volume: toTokenVolume } =
      this.getLatestPriceInUSD(toTokenAddr);
    const amountSold = new BigNumber(fromTokenAmount).div(
      this.getDecimals(fromTokenAddr)
    );
    const amountBought = new BigNumber(toTokenAmount).div(
      this.getDecimals(toTokenAddr)
    );
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

    if (blockNumber >= this.startBlockNumber + this.tick) {
      // cache history token price
      let fromTokenHistory = this.historyUSDPrice[fromTokenAddr] ?? [];
      let toTokenHistory = this.historyUSDPrice[toTokenAddr] ?? [];

      // discard oldest history records
      if (fromTokenHistory.length >= this.maxHistoryRecords) {
        fromTokenHistory = fromTokenHistory.slice(-this.maxHistoryRecords);
        toTokenHistory = toTokenHistory.slice(-this.maxHistoryRecords);
      }

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
        { price: newToTokenPrice, volume: amountBought, address, protocol },
      ];
      this.tokenPrice[this.getTokenPairKey(fromTokenAddr, toTokenAddr)] = [
        { price: newFromTokenPrice, volume: amountSold, address, protocol },
      ];

      // update block number
      const num = Math.floor((blockNumber - this.startBlockNumber) / this.tick);
      // fast-forward
      this.startBlockNumber += this.tick * num;
      this.numRounds += 1;
    } else if (
      blockNumber < this.startBlockNumber + this.tick &&
      blockNumber >= this.startBlockNumber
    ) {
      /// push price to the current round
      const pairKey0 = this.getTokenPairKey(toTokenAddr, fromTokenAddr);
      const pairKey1 = this.getTokenPairKey(fromTokenAddr, toTokenAddr);
      if (pairKey0 in this.tokenPrice) {
        this.tokenPrice[pairKey0].push({
          price: newToTokenPrice,
          volume: amountBought,
          address,
          protocol,
        });
        this.tokenPrice[pairKey1].push({
          price: newFromTokenPrice,
          volume: amountSold,
          address,
          protocol,
        });
      } else {
        this.tokenPrice[pairKey0] = [
          {
            price: newToTokenPrice,
            volume: amountBought,
            address,
            protocol,
          },
        ];
        this.tokenPrice[pairKey1] = [
          {
            price: newFromTokenPrice,
            volume: amountSold,
            address,
            protocol,
          },
        ];
      }
    } else {
      logger.warn(
        `blockNumber: ${blockNumber} is out of date, current round is in [${
          this.startBlockNumber
        }, ${
          this.startBlockNumber + this.tick - 1
        }]. so discard the swap event!`
      );
    }

    return volume.dp(this.priceDecimals);
  }
}
