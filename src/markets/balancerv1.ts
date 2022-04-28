import retry from "async-retry";
import { ethers } from "ethers";
import { gql, GraphQLClient } from "graphql-request";

import { blockNumberPerDay, DAY, DefaultCollectionName } from "../constants";
import { logger } from "../logging";
import { Database } from "../mongodb";
import { CollectionName, PoolWithVolume, Protocol } from "../types";

import { MarketInterface } from "./market_interface";

const BALANCER_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer";

export type RawSubgraphPool = {
  id: string;
  tokens: { address: string; symbol: string }[];
  totalSwapVolume: string;
};

export class BalancerSubgraphIndexer implements MarketInterface {
  protected subgraph_url: string;
  protected pageSize: number;
  protected retries: number;
  protected client: GraphQLClient;
  constructor(
    protected database: Database,
    protected provider: ethers.providers.JsonRpcProvider,
    protected collectionName: CollectionName = DefaultCollectionName
  ) {
    this.subgraph_url = BALANCER_SUBGRAPH_URL;
    this.pageSize = 1000;
    this.client = new GraphQLClient(this.subgraph_url);
    this.retries = 3;
  }

  async fetchPoolsFromSubgraph(blockNumber: number) {
    const query = gql`
      query fetchTopPools($pageSize: Int!, $id: String, $blockNumber: Int!) {
        pools(
          first: $pageSize
          where: { id_gt: $id }
          block: { number: $blockNumber }
        ) {
          id
          tokens {
            address
            symbol
          }
          totalSwapVolume
        }
      }
    `;
    let allPools: RawSubgraphPool[] = [];
    // get all pools using page mode
    const getPools = async (): Promise<RawSubgraphPool[]> => {
      let lastId = "";
      let pools: RawSubgraphPool[] = [];
      let poolsPage: RawSubgraphPool[] = [];
      do {
        await retry(
          async () => {
            const poolsResult = await this.client.request<{
              pools: RawSubgraphPool[];
            }>(query, { pageSize: this.pageSize, id: lastId, blockNumber });
            poolsPage = poolsResult.pools;
            pools = pools.concat(poolsPage);
            lastId = pools[pools.length - 1].id;
          },
          {
            retries: this.retries,
            onRetry: (error, retry) => {
              logger.error(
                `Failed request for page of pools from subgraph due to ${error}. Retry attempt: ${retry}`
              );
            },
          }
        );
        logger.info(`processing ${pools.length}th pools`);
      } while (poolsPage.length > 0);

      return pools;
    };

    allPools = await getPools();
    return allPools;
  }

  async processAllSnapshots() {}

  async processAllPools() {
    const block = await this.provider.getBlock("latest");
    const blockNumber = block.number - 20;
    const latestDayId = Math.floor(block.timestamp / DAY).toString();
    const subgraphPools0 = await this.fetchPoolsFromSubgraph(blockNumber);
    const subgraphPools1 = await this.fetchPoolsFromSubgraph(
      blockNumber - blockNumberPerDay
    );
    const dailySwapVolume = subgraphPools1.map((subgraphPool1, ind) =>
      (
        parseFloat(subgraphPools0[ind].totalSwapVolume) -
        parseFloat(subgraphPool1.totalSwapVolume)
      ).toString()
    );
    const pools: PoolWithVolume[] = subgraphPools0.map(
      (subgraphPool0, ind) => ({
        protocol: Protocol.Balancer,
        id: subgraphPool0.id,
        latestDailyVolumeUSD: dailySwapVolume[ind],
        latestDayId,
        tokens: subgraphPool0.tokens.map((token) => ({
          id: token.address,
          symbol: token.symbol,
        })),
      })
    );

    await this.database.saveMany(pools, this.collectionName.pool);
  }
}
