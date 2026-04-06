import { AppConfig } from "../config/env";
import { BinanceMove, MarketMetadata, PolymarketBookSnapshot } from "../persistence/models";
import { clamp } from "../utils/math";

export interface LagObservation {
  outcome: "YES" | "NO";
  referencePrice: number;
  expectedProbability: number;
  reasons: string[];
  stale: boolean;
}

export class PolymarketLagDetector {
  constructor(private readonly config: AppConfig) {}

  evaluate(
    market: MarketMetadata,
    yesBook: PolymarketBookSnapshot | undefined,
    noBook: PolymarketBookSnapshot | undefined,
    move: BinanceMove | null,
  ): LagObservation | null {
    if (!move || move.direction === "FLAT") {
      return null;
    }

    if (!yesBook?.midpoint || !noBook?.midpoint) {
      return null;
    }

    const now = Date.now();
    const stale =
      now - yesBook.receivedAt > this.config.risk.staleBookMs ||
      now - noBook.receivedAt > this.config.risk.staleBookMs;

    const sensitivity =
      market.intervalMinutes === 5
        ? this.config.signal.poly5mSensitivity
        : this.config.signal.poly15mSensitivity;

    const signedProbabilityDelta = (move.signedBps * sensitivity) / 10_000;
    const referenceYes = yesBook.midpoint;
    const expectedYes = clamp(referenceYes + signedProbabilityDelta, 0.01, 0.99);
    const outcome = move.direction === "UP" ? "YES" : "NO";
    const expectedProbability = outcome === "YES" ? expectedYes : 1 - expectedYes;
    const referencePrice = outcome === "YES" ? referenceYes : noBook.midpoint;

    const reasons: string[] = [];
    if (stale) {
      reasons.push("orderbook_stale");
    }

    return {
      outcome,
      referencePrice,
      expectedProbability,
      reasons,
      stale,
    };
  }
}
