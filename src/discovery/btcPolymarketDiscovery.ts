import { Logger } from "pino";
import { PolymarketClobGateway } from "../clients/polymarketClobClient";
import { PolymarketDiscoveryClient } from "../clients/polymarketDiscoveryClient";
import { DiscoveredMarket, MarketMetadata } from "../persistence/models";
import { evaluateBtcTargetMarket, toDiscoveredMarket, toMarketMetadata } from "./marketMapper";

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
    const scanResult = await this.discoveryClient.collectBtcMarkets((market) => evaluateBtcTargetMarket(market));
    const evaluations = scanResult.markets.map((market) => ({
      market,
      evaluation: evaluateBtcTargetMarket(market),
    }));

    const discovered: DiscoveredMarket[] = [];
    const metadata: MarketMetadata[] = [];

    this.logger.info(
      {
        component: "btcDiscovery",
        source: scanResult.stats.source,
        pageSize: scanResult.stats.pageSize,
        pagesConsulted: scanResult.stats.pagesConsulted,
        marketsScanned: scanResult.stats.marketsScanned,
        candidatesSeen: scanResult.stats.candidatesSeen,
        candidatesRetained: scanResult.stats.candidatesRetained,
        retainedByInterval: scanResult.stats.retainedByInterval,
        earlyStop: scanResult.stats.earlyStop,
        fallbackUsed: scanResult.stats.fallbackUsed,
      },
      "Completed Gamma BTC discovery scan",
    );

    for (const { market, evaluation } of evaluations) {
      if (!evaluation.isTarget) {
        this.logger.info(
          {
            component: "btcDiscovery",
            marketId: market.id,
            slug: market.slug,
            ticker: market.ticker,
            question: market.question,
            matchedBy: evaluation.matchedBy,
            matchedPattern: evaluation.matchedPattern,
            discardReason: evaluation.discardReason,
          },
          "Discarded Gamma BTC discovery candidate",
        );
        continue;
      }

      const discoveredMarket = toDiscoveredMarket(market, evaluation);
      if (!discoveredMarket) {
        this.logger.info(
          {
            component: "btcDiscovery",
            marketId: market.id,
            slug: market.slug,
            ticker: market.ticker,
            matchedBy: evaluation.matchedBy,
            matchedPattern: evaluation.matchedPattern,
          },
          "Matched Gamma candidate but could not map discovered market",
        );
        continue;
      }

      this.logger.info(
        {
          component: "btcDiscovery",
          marketId: market.id,
          slug: market.slug,
          ticker: market.ticker,
          conditionId: discoveredMarket.conditionId,
          intervalMinutes: discoveredMarket.intervalMinutes,
          matchedBy: evaluation.matchedBy,
          matchedPattern: evaluation.matchedPattern,
        },
        "Matched Gamma BTC target market",
      );

      discovered.push(discoveredMarket);

      const enrichmentId = discoveredMarket.conditionId;
      const enrichmentEndpoint = `/markets/${enrichmentId}`;

      try {
        this.logger.info(
          {
            component: "btcDiscovery",
            marketId: market.id,
            slug: market.slug,
            conditionId: discoveredMarket.conditionId,
            enrichmentId,
            enrichmentEndpoint,
            enrichmentSource: "clob",
          },
          "Attempting optional CLOB metadata enrichment",
        );

        const clobMarket = await this.clobGateway.getMarket(enrichmentId);
        const mappedMetadata = toMarketMetadata(market, clobMarket, evaluation);
        if (mappedMetadata) {
          metadata.push(mappedMetadata);
          this.logger.info(
            {
              component: "btcDiscovery",
              marketId: market.id,
              slug: market.slug,
              conditionId: discoveredMarket.conditionId,
              enrichmentId,
              enrichmentEndpoint,
              metadataSource: "gamma+clob",
            },
            "Built BTC market metadata",
          );
        } else {
          this.logger.info(
            {
              component: "btcDiscovery",
              marketId: market.id,
              slug: market.slug,
              conditionId: discoveredMarket.conditionId,
              matchedBy: evaluation.matchedBy,
              matchedPattern: evaluation.matchedPattern,
              discardReason: "metadata_mapping_failed",
            },
            "Discarded Gamma BTC metadata enrichment candidate",
          );
        }
      } catch (error) {
        const fallbackMetadata = toMarketMetadata(market, undefined, evaluation);
        if (fallbackMetadata) {
          metadata.push(fallbackMetadata);
          this.logger.warn(
            {
              component: "btcDiscovery",
              marketId: market.id,
              slug: market.slug,
              conditionId: discoveredMarket.conditionId,
              enrichmentId,
              enrichmentEndpoint,
              metadataSource: "gamma",
              err: error,
            },
            "CLOB metadata enrichment failed; using Gamma metadata for shadow mode",
          );
          continue;
        }

        this.logger.error(
          {
            component: "btcDiscovery",
            conditionId: discoveredMarket.conditionId,
            slug: market.slug,
            enrichmentId,
            enrichmentEndpoint,
            metadataSource: "none",
            err: error,
          },
          "Failed to build BTC market metadata from both CLOB and Gamma",
        );
      }
    }

    this.logger.info(
      {
        component: "btcDiscovery",
        discovered: discovered.length,
        metadata: metadata.length,
        candidatesRetained: scanResult.stats.candidatesRetained,
        pagesConsulted: scanResult.stats.pagesConsulted,
        earlyStop: scanResult.stats.earlyStop,
      },
      "BTC Polymarket discovery completed",
    );

    return {
      discovered,
      metadata,
    };
  }
}
