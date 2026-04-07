import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { MarketMetadata, BinanceMove, PolymarketBookSnapshot, TradeSignal } from "../persistence/models";
import { SignalScorer } from "../strategy/signalScorer";
import { EdgeCalculator } from "./edgeCalculator";
import { PolymarketLagDetector } from "./polymarketLagDetector";
import { computeSpreadObserved, evaluateSignalNoise } from "./signalMetricPolicy";

export class SignalEngine {
  constructor(
    private readonly config: AppConfig,
    private readonly lagDetector: PolymarketLagDetector,
    private readonly edgeCalculator: EdgeCalculator,
    private readonly signalScorer: SignalScorer,
  ) {}

  evaluate(
    market: MarketMetadata,
    yesBook: PolymarketBookSnapshot | undefined,
    noBook: PolymarketBookSnapshot | undefined,
    move: BinanceMove | null,
  ): TradeSignal | null {
    const lag = this.lagDetector.evaluate(market, yesBook, noBook, move);
    if (!lag || !move) {
      return null;
    }

    const targetBook = lag.outcome === "YES" ? yesBook : noBook;
    const edge = this.edgeCalculator.calculate(market, targetBook, lag.expectedProbability);
    if (!edge) {
      return null;
    }

    const baseSignal: Omit<TradeSignal, "score" | "status"> = {
      id: randomUUID(),
      createdAt: Date.now(),
      conditionId: market.conditionId,
      intervalMinutes: market.intervalMinutes,
      outcome: lag.outcome,
      side: "BUY",
      referencePrice: lag.referencePrice,
      targetPrice: edge.limitPrice,
      bookPrice: edge.bookPrice,
      bestBid: targetBook?.bestBid ?? null,
      bestAsk: targetBook?.bestAsk ?? null,
      expectedProbability: lag.expectedProbability,
      executableSize: edge.executableSize,
      depthAvailable: edge.depthAvailable,
      notional: edge.notional,
      grossEdgeBps: edge.grossEdgeBps,
      netEdgeBps: edge.netEdgeBps,
      stale: lag.stale,
      reasons: [...lag.reasons, ...edge.reasons],
      move,
    };

    const { spreadObservedBps } = computeSpreadObserved(baseSignal.bestBid, baseSignal.bestAsk, edge.bookPrice);
    const noiseDecision = evaluateSignalNoise(this.config, {
      intervalMinutes: market.intervalMinutes,
      priceReference: edge.bookPrice,
      spreadObservedBps,
      binanceMoveBps: move.absoluteBps,
    });
    if (noiseDecision.reason) {
      baseSignal.reasons.push(noiseDecision.reason);
    }

    const score = this.signalScorer.score(baseSignal, move);
    const approved =
      !baseSignal.stale &&
      baseSignal.netEdgeBps >= this.config.execution.edgeThresholdBps &&
      score >= this.config.execution.signalMinScore &&
      baseSignal.executableSize >= market.minimumOrderSize &&
      !noiseDecision.suppress;

    return {
      ...baseSignal,
      score,
      status: approved ? "approved" : "discarded",
    };
  }
}
