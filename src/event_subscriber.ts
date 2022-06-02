import { ethers, Contract } from "ethers";
import { Interface } from "@ethersproject/abi";
import { BigNumber } from "bignumber.js";
import { UniswapV2Pair__factory, UniswapV3Pool__factory } from "./typechain";
import { Protocol, SwapEvent } from "./types";
import { TokenPricing } from "./pricing";
import { tokens } from "./tokens";

export type ContractPublisher = {
  protocol: Protocol;
  address: string;
};
const Zero = new BigNumber(0);

export class EventSuscriber {
  // protected uniswapV2: Contract;
  protected swapEvents: SwapEvent[];
  protected contractPublishers: ContractPublisher[];

  protected totalVolumeInUSD: BigNumber;
  protected decimals: number;
  constructor(
    protected tokenPricing: TokenPricing,
    protected provider: ethers.providers.JsonRpcProvider,
    protected fromBlock: number,
    protected confirmation: number = 2
  ) {
    this.swapEvents = [];
    this.contractPublishers = [];
    this.totalVolumeInUSD = Zero;
    this.decimals = 8;
  }

  public registerPublisher(contractPub: ContractPublisher) {
    this.contractPublishers.push(contractPub);
  }

  private async syncLogsPerProtocol(
    contractPub: ContractPublisher,
    fromBlock: number,
    toBlock: number
  ) {
    const contractAddr: string = contractPub.address;
    const protocol: Protocol = contractPub.protocol;

    switch (protocol) {
      case Protocol.UniswapV2: {
        const iface = UniswapV2Pair__factory.createInterface();
        const contract = new ethers.Contract(
          contractAddr,
          iface,
          this.provider
        );
        const filter = contract.filters.Swap();
        const token0 = await contract.token0();
        const token1 = await contract.token1();
        const exchangeLogs = await contract.queryFilter(
          filter,
          fromBlock,
          toBlock
        );
        const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
          const { amount0In, amount0Out, amount1In, amount1Out } = log.args!;
          const fromToken = amount0In.gt(0) ? token0 : token1;
          const toToken = amount1Out.gt(0) ? token1 : token0;
          const amountIn = amount0In.gt(0) ? amount0In : amount1In;
          const amountOut = amount0Out.gt(0) ? amount0Out : amount1Out;
          return {
            fromToken,
            toToken,
            amountIn: amountIn.toString(),
            amountOut: amountOut.toString(),
            blockNumber: log.blockNumber,
            address: log.address,
            protocol: Protocol.UniswapV2,
          };
        });
        this.swapEvents.push(...swapEvents);
        break;
      }
      case Protocol.UniswapV3: {
        const pairContract = UniswapV3Pool__factory.connect(
          contractAddr,
          this.provider
        );
        const filter = pairContract.filters.Swap();
        const exchangeLogs = await pairContract.queryFilter(
          filter,
          fromBlock,
          toBlock
        );
        const token0 = await pairContract.token0();
        const token1 = await pairContract.token1();

        const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
          const { amount0, amount1 } = log.args;
          const fromToken = amount0.gt(0) ? token0 : token1;
          const toToken = amount0.lt(0) ? token0 : token1;
          const amountIn = amount0.gt(0) ? amount0 : amount1;
          const amountOut = amount0.lt(0) ? amount0 : amount1;
          return {
            fromToken,
            toToken,
            amountIn: amountIn.toString(),
            amountOut: amountOut.abs().toString(),
            blockNumber: log.blockNumber,
            address: log.address,
            protocol: Protocol.UniswapV3,
          };
        });
        this.swapEvents.push(...swapEvents);
        break;
      }
      case Protocol.BalancerV2: {
        const abi = [
          "event Swap(bytes32 indexed poolId,address indexed tokenIn,address indexed tokenOut,uint256 amountIn,uint256 amountOut)",
        ];
        const vault = new ethers.Contract(contractAddr, abi, this.provider);
        const filter = vault.filters.Swap(
          null,
          tokens.WETH.address,
          tokens.USDC.address
        );
        const exchangeLogs = await vault.queryFilter(filter, fromBlock);
        const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
          const { poolId, tokenIn, tokenOut, amountIn, amountOut } = log.args!;
          return {
            fromToken: tokenIn,
            toToken: tokenOut,
            amountIn: amountIn.toString(),
            amountOut: amountOut.toString(),
            blockNumber: log.blockNumber,
            address: poolId,
            protocol: Protocol.BalancerV2,
          };
        });
        this.swapEvents.push(...swapEvents);
        break;
      }
      case Protocol.Balancer: {
        const abi = [
          "event LOG_SWAP(address indexed caller, address indexed tokenIn, address indexed tokenOut, uint256 tokenAmountIn, uint256 tokenAmountOut)",
        ];
        const vault = new ethers.Contract(contractAddr, abi, this.provider);
        const filter = vault.filters.LOG_SWAP(
          null,
          tokens.USDC.address,
          tokens.WETH.address
        );
        const exchangeLogs = await vault.queryFilter(filter, fromBlock);
        const swapEvents: SwapEvent[] = exchangeLogs.map((log) => {
          const { tokenIn, tokenOut, tokenAmountIn, tokenAmountOut } =
            log.args!;
          return {
            fromToken: tokenIn,
            toToken: tokenOut,
            amountIn: tokenAmountIn.toString(),
            amountOut: tokenAmountOut.toString(),
            blockNumber: log.blockNumber,
            address: log.address,
            protocol: Protocol.Balancer,
          };
        });
        this.swapEvents.push(...swapEvents);
        break;
      }
    }
  }

  public getTotalVolumeInUSD() {
    return this.totalVolumeInUSD.dp(this.decimals);
  }

  async syncLogs(fromBlock: number, toBlock: number) {
    const promises = [];
    for (const contractPub of this.contractPublishers) {
      promises.push(this.syncLogsPerProtocol(contractPub, fromBlock, toBlock));
    }
    await Promise.all(promises);
    const totalVolumeUSD = this.swapEvents
      .sort((a, b) => a.blockNumber - b.blockNumber)
      .map(
        ({
          fromToken,
          toToken,
          amountIn,
          amountOut,
          blockNumber,
          address,
          protocol,
        }) => {
          if (fromToken === toToken) {
            return Zero;
          }
          const volumeUSD = this.tokenPricing.volumeInUSD(
            fromToken,
            amountIn,
            toToken,
            amountOut,
            blockNumber,
            address,
            protocol
          );
          return volumeUSD;
        }
      )
      .reduce((res, cur) => res.plus(cur), Zero);

    // clean consumed events
    this.swapEvents.length = 0;
    return totalVolumeUSD;
  }

  start() {
    this.provider.on("block", async (blockTag) => {
      if (blockTag >= this.fromBlock + this.confirmation) {
        const toBlock = blockTag - this.confirmation;
        const totalVolumeInUSD = await this.syncLogs(this.fromBlock, toBlock);
        this.totalVolumeInUSD = this.totalVolumeInUSD.plus(
          totalVolumeInUSD.toString()
        );
        // fast-forward
        this.fromBlock = toBlock + 1;
      }
    });
  }
}
