import { Logger } from "pino";
import { PolymarketClobGateway } from "../clients/polymarketClobClient";
import { PolymarketDiscoveryClient } from "../clients/polymarketDiscoveryClient";
import { DiscoveredMarket, MarketMetadata } from "../persistence/models";
import { isBtcTargetMarket, toDiscoveredMarket, toMarketMetadata } from "./marketMapper";

export interface DiscoveryResult {
  discovered: DiscoveredMarket[];
  metadata: MarketMetadata[];
}

export class BtcPolymarketDiscovery {
  constructor(
    private readonly discoveryClient: PolymarketDiscoveryClient,
    private readonly clobGateway: PolymarketClobGateway,
    private readonly logger: Logger,
  ) {}

  async discover(): Promise<DiscoveryResult> {
    const gammaMarkets = await this.discoveryClient.listActiveMarkets();
    const targetGammaMarkets = gammaMarkets.filter(isBtcTargetMarket);

    const discovered: DiscoveredMarket[] = [];
    const metadata: MarketMetadata[] = [];

    for (const market of targetGammaMarkets) {
      if (!(market.conditionId ?? market.condition_id)) {
        continue;
      }

      const discoveredMarket = toDiscoveredMarket(market);
      if (!discoveredMarket) {
        continue;
      }

      discovered.push(discoveredMarket);

      try {
        const clobMarket = await this.clobGateway.getMarket(discoveredMarket.conditionId);
        const mappedMetadata = toMarketMetadata(market, clobMarket);
        if (mappedMetadata) {
          metadata.push(mappedMetadata);
        }
      } catch (error) {
        this.logger.error(
          {
            component: "btcDiscovery",
            conditionId: discoveredMarket.conditionId,
            err: error,
          },
          "Failed to enrich Polymarket metadata from CLOB",
        );
      }
    }

    this.logger.info(
      { component: "btcDiscovery", discovered: discovered.length, metadata: metadata.length },
      "BTC Polymarket discovery completed",
    );

    return {
      discovered,
      metadata,
    };
  }
}
