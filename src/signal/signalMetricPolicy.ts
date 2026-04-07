import { AppConfig } from "../config/env";
import { Outcome } from "../persistence/models";

export const SIGNAL_DEDUP_WINDOW_MS = 1_500;
export const SIGNAL_MOVE_BUCKET_BPS = 2;
export const SIGNAL_MAX_VIABLE_SPREAD_BPS = 150;

export interface SignalTiming {
  binanceMoveDetectedAt: number;
  polymarketDetectedAt: number;
  estimatedDelayMs: number;
}

export interface SignalNoiseDecision {
  suppress: boolean;
  reason: "spread_too_wide" | "move_below_viable_threshold" | null;
  minimumViableMoveBps: number;
  maxViableSpreadBps: number;
}

export function computeSpreadObserved(
  bestBid: number | null,
  bestAsk: number | null,
  fallbackPrice: number,
): { spreadObserved: number; spreadObservedBps: number } {
  const spreadObserved = bestAsk != null && bestBid != null ? bestAsk - bestBid : 0;
  const midpoint = bestAsk != null && bestBid != null ? (bestAsk + bestBid) / 2 : fallbackPrice;
  const spreadObservedBps = midpoint > 0 ? (spreadObserved / midpoint) * 10_000 : 0;

  return {
    spreadObserved,
    spreadObservedBps,
  };
}

export function computeSignalTiming(
  moveDetectedAt: number,
  bookTimestamp: number,
  bookReceivedAt: number,
): SignalTiming {
  const normalizedMoveDetectedAt = normalizeTimestampMs(moveDetectedAt);
  const normalizedBookTimestamp = normalizeTimestampMs(bookTimestamp);
  const normalizedBookReceivedAt = normalizeTimestampMs(bookReceivedAt);
  const polymarketDetectedAt = choosePolymarketObservedAt(normalizedBookTimestamp, normalizedBookReceivedAt);

  return {
    binanceMoveDetectedAt: normalizedMoveDetectedAt,
    polymarketDetectedAt,
    estimatedDelayMs: Math.abs(polymarketDetectedAt - normalizedMoveDetectedAt),
  };
}

export function computeMinimumViableMoveBps(
  config: AppConfig,
  intervalMinutes: 5 | 15,
  priceReference: number,
  spreadObservedBps: number,
): number {
  const sensitivity =
    intervalMinutes === 5
      ? config.signal.poly5mSensitivity
      : config.signal.poly15mSensitivity;

  if (sensitivity <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const requiredGrossEdgeBps =
    Math.max(0, spreadObservedBps) +
    config.execution.slippageBufferBps +
    config.execution.edgeThresholdBps;

  return Number(((requiredGrossEdgeBps * Math.max(priceReference, 0.01)) / sensitivity).toFixed(2));
}

export function evaluateSignalNoise(
  config: AppConfig,
  input: {
    intervalMinutes: 5 | 15;
    priceReference: number;
    spreadObservedBps: number;
    binanceMoveBps: number;
  },
): SignalNoiseDecision {
  const minimumViableMoveBps = computeMinimumViableMoveBps(
    config,
    input.intervalMinutes,
    input.priceReference,
    input.spreadObservedBps,
  );

  if (input.spreadObservedBps > SIGNAL_MAX_VIABLE_SPREAD_BPS) {
    return {
      suppress: true,
      reason: "spread_too_wide",
      minimumViableMoveBps,
      maxViableSpreadBps: SIGNAL_MAX_VIABLE_SPREAD_BPS,
    };
  }

  if (input.binanceMoveBps < minimumViableMoveBps) {
    return {
      suppress: true,
      reason: "move_below_viable_threshold",
      minimumViableMoveBps,
      maxViableSpreadBps: SIGNAL_MAX_VIABLE_SPREAD_BPS,
    };
  }

  return {
    suppress: false,
    reason: null,
    minimumViableMoveBps,
    maxViableSpreadBps: SIGNAL_MAX_VIABLE_SPREAD_BPS,
  };
}

export function buildSignalFingerprint(input: {
  conditionId: string;
  outcome: Outcome;
  binanceMoveBps: number;
}): string {
  const moveBucket = Math.round(input.binanceMoveBps / SIGNAL_MOVE_BUCKET_BPS) * SIGNAL_MOVE_BUCKET_BPS;

  return [
    input.conditionId,
    input.outcome,
    `move=${moveBucket.toFixed(0)}`,
  ].join("|");
}

function normalizeTimestampMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value < 1_000_000_000_000 ? value * 1000 : value;
}

function choosePolymarketObservedAt(bookTimestamp: number, bookReceivedAt: number): number {
  if (!Number.isFinite(bookTimestamp) || bookTimestamp <= 0) {
    return bookReceivedAt;
  }

  if (!Number.isFinite(bookReceivedAt) || bookReceivedAt <= 0) {
    return bookTimestamp;
  }

  const drift = Math.abs(bookReceivedAt - bookTimestamp);
  if (drift <= 60_000) {
    return bookTimestamp;
  }

  return bookReceivedAt;
}
