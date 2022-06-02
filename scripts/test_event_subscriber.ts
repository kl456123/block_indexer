import { EventSuscriber } from "../src/event_subscriber";
import { ethers } from "ethers";

import { tokens } from "../src/tokens";
import { CommonToken, Protocol } from "../src/types";
import { TokenPricing } from "../src/pricing";
import { logger } from "../src/logging";

async function main() {
  const url = "http://35.75.165.133:8545";
  const provider = new ethers.providers.JsonRpcProvider(url);
  const currentBlockNumber = await provider.getBlockNumber();
  const fromBlock = currentBlockNumber;

  // contract api
  const tokensMap: Record<string, CommonToken> = {};
  Object.values(tokens).forEach((token) => {
    tokensMap[token.address.toLowerCase()] = token;
  });
  const tick = 20;
  const tokenPricing = new TokenPricing(tick, tokensMap, provider);
  const eventSubscriber = new EventSuscriber(tokenPricing, provider, fromBlock);
  eventSubscriber.registerPublisher({
    address: "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc",
    protocol: Protocol.UniswapV2,
  });
  eventSubscriber.registerPublisher({
    address: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    protocol: Protocol.UniswapV3,
  });
  eventSubscriber.registerPublisher({
    address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    protocol: Protocol.BalancerV2,
  });
  eventSubscriber.registerPublisher({
    address: "0xE7ce624C00381b4b7aBB03e633fB4aCaC4537dD6",
    protocol: Protocol.Balancer,
  });
  eventSubscriber.start();

  setInterval(() => {
    const { round, price, volume, priceWithVolumePerPool } =
      tokenPricing.getLatestPriceInUSD(tokens.WETH.address);
    logger.info(`num of rounds: ${round}\n`);
    logger.info(`weighted average price: ${price}, volume: ${volume}`);
    for (const item of priceWithVolumePerPool) {
      logger.info(
        `protocol: ${item.protocol}, address: ${item.address}, average price: ${item.price}, volume: ${item.volume}`
      );
    }
  }, 20000);
}

main();
