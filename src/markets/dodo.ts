import { utils, ethers, BaseContract, EventFilter } from "ethers";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { Pool, Protocol } from "../types";
import { MarketInterface } from "./market_interface";
import {
  DVMFactory__factory,
  DPPFactory__factory,
  DSPFactory__factory,
  CrowdPoolingFactory__factory,
  DVMFactory,
  DPPFactory,
  DSPFactory,
  CrowdPoolingFactory,
  IERC20__factory,
  DODO__factory,
} from "../typechain";

const dvmFactoryAddr = "0x72d220cE168C4f361dD4deE5D826a01AD8598f6C";
const dspFactoryAddr = "0x6fdDB76c93299D985f4d3FC7ac468F9A168577A4";
const dppFactoryAddr = "0x5336edE8F971339F6c0e304c66ba16F1296A2Fbe";
const dcpFactoryAddr = "0xE8C9A78725D0451FA19878D5f8A3dC0D55FECF25";

const DodoV1Addrs: string[] = [
  "0x75c23271661d9d143dcb617222bc4bec783eff34", //WETH-USDC
  "0x562c0b218cc9ba06d9eb42f3aef54c54cc5a4650", //LINK-USDC
  "0x9d9793e1e18cdee6cf63818315d55244f73ec006", //FIN-USDT
  "0xca7b0632bd0e646b0f823927d3d2e61b00fe4d80", //SNX-USDC
  "0x0d04146b2fe5d267629a7eb341fb4388dcdbd22f", //COMP-USDC
  "0x2109f78b46a789125598f5ad2b7f243751c2934d", //WBTC-USDC
  "0x1b7902a66f133d899130bf44d7d879da89913b2e", //YFI-USDC
  "0x1a7fe5d6f0bb2d071e16bdd52c863233bbfd38e9", //WETH-USDT
  "0x8876819535b48b551c9e97ebc07332c7482b4b2d", //DODO-USDT
  "0xc9f93163c99695c6526b799ebca2207fdf7d61ad", //USDT-USDC
  "0x94512fd4fb4feb63a6c0f4bedecc4a00ee260528", //AAVE-USDC
  "0x85f9569b69083c3e6aeffd301bb2c65606b5d575", //wCRES-USDT
  "0x181d93ea28023bf40c8bb94796c55138719803b4", //WOO-USDT
];

export class DodoIndexer implements MarketInterface {
  protected dvmFactory: DVMFactory;
  protected dppFactory: DPPFactory;
  protected dspFactory: DSPFactory;
  protected dcpFactory: CrowdPoolingFactory;
  constructor(
    protected database: Database,
    protected collectionName: string,
    protected provider: ethers.providers.JsonRpcProvider
  ) {
    this.dvmFactory = DVMFactory__factory.connect(
      dvmFactoryAddr,
      this.provider
    );
    this.dspFactory = DSPFactory__factory.connect(
      dspFactoryAddr,
      this.provider
    );
    this.dppFactory = DPPFactory__factory.connect(
      dppFactoryAddr,
      this.provider
    );
    this.dcpFactory = CrowdPoolingFactory__factory.connect(
      dcpFactoryAddr,
      this.provider
    );
  }

  async fetchPoolsFromChain() {
    const pools = [];
    const poolsV1 = await this.fetchPoolsV1();
    pools.push(...poolsV1);

    // const poolsV2 = await this.fetchPoolsV2();
    // pools.push(...poolsV2);

    return pools;
  }

  async fetchPoolsV1() {
    // dodov1
    const promisesv1 = DodoV1Addrs.map((poolAddr) =>
      this.fetchDODOV1Pool(poolAddr)
    );
    const pools = await Promise.all(promisesv1);
    return pools;
  }

  async fetchPoolsV2() {
    // dodov2
    const promisesv2 = [];
    promisesv2.push(
      this.fetchPoolsFromChainSingle(
        this.dvmFactory,
        this.dvmFactory.filters.NewDVM(),
        11704651
      )
    );
    promisesv2.push(
      this.fetchPoolsFromChainSingle(
        this.dspFactory,
        this.dspFactory.filters.NewDSP(),
        12269078
      )
    );
    promisesv2.push(
      this.fetchPoolsFromChainSingle(
        this.dppFactory,
        this.dppFactory.filters.NewDPP(),
        13397058
      )
    );
    promisesv2.push(
      this.fetchPoolsFromChainSingle(
        this.dcpFactory,
        this.dcpFactory.filters.NewCP(),
        11704666
      )
    );
    const pools = (await Promise.all(promisesv2)).flat();
    return pools;
  }

  async fetchDODOV1Pool(poolAddr: string) {
    const dodoPool = DODO__factory.connect(poolAddr, this.provider);
    const baseToken = await dodoPool._BASE_TOKEN_();
    const quoteToken = await dodoPool._QUOTE_TOKEN_();
    return {
      protocol: Protocol.DODO,
      id: poolAddr,
      tokens: [baseToken, quoteToken],
    };
  }

  async fetchPoolsFromChainSingle(
    dvmFactory: BaseContract,
    filter: EventFilter,
    fromBlock: number
  ) {
    const newDVMPoolEvents = await dvmFactory.queryFilter(filter, fromBlock);
    const dvmPools: Pool[] = newDVMPoolEvents.map((event) => {
      const args = event.args!;
      const baseToken = args[0];
      const quoteToken = args[1];
      const poolAddr = args[3];
      return {
        protocol: Protocol.DODOV2,
        id: poolAddr,
        tokens: [baseToken, quoteToken],
        liquidity: ["0", "0"],
      };
    });
    return dvmPools;
  }

  async processAllPools() {
    const pools = await this.fetchPoolsFromChain();
    await this.database.saveMany(pools, this.collectionName);
  }

  async processAllTokens() {
    throw new Error(`Unimplementation Error`);
  }
}
