import { AppConfig } from "../config/env";
import { MarketMetadata, PolymarketBookSnapshot } from "../persistence/models";
import { estimateFillFromBook, roundUpToTick } from "../utils/math";

export interface EdgeResult {
  bookPrice: number;
  limitPrice: number;
  executableSize: number;
  depthAvailable: number;
  notional: number;
  grossEdgeBps: number;
  netEdgeBps: number;
  reasons: string[];
}

export class EdgeCalculator {
  constructor(private readonly config: AppConfig) {}

  calculate(
    market: MarketMetadata,
    book: PolymarketBookSnapshot | undefined,
    expectedProbability: number,
  ): EdgeResult | null {
    if (!book || book.asks.length === 0 || book.bestAsk == null) {
      return null;
    }

    const desiredSize = this.config.execution.maxNotionalPerTrade / book.bestAsk;
    const fillEstimate = estimateFillFromBook(book.asks, desiredSize);
    if (fillEstimate.averagePrice == null || fillEstimate.filledSize === 0) {
      return null;
    }

    const bookPrice = fillEstimate.averagePrice;
    const feeCost = bookPrice * (market.takerFeeBps / 10_000);
    const slippageCost = bookPrice * (this.config.execution.slippageBufferBps / 10_000);
    const grossEdge = expectedProbability - bookPrice;
    const netEdge = grossEdge - feeCost - slippageCost;

    const reasons: string[] = [];
    if (fillEstimate.exhausted) {
      reasons.push("insufficient_depth");
    }
    if (fillEstimate.filledSize < market.minimumOrderSize) {
      reasons.push("below_min_order_size");
    }

    return {
      bookPrice,
      limitPrice: roundUpToTick(bookPrice + slippageCost, market.minimumTickSize),
      executableSize: fillEstimate.filledSize,
      depthAvailable: fillEstimate.filledSize,
      notional: fillEstimate.notional,
      grossEdgeBps: (grossEdge / bookPrice) * 10_000,
      netEdgeBps: (netEdge / bookPrice) * 10_000,
      reasons,
    };
  }
}
