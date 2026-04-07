import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env";
import {
  buildSignalFingerprint,
  computeSignalTiming,
  computeSpreadObserved,
  evaluateSignalNoise,
} from "../src/signal/signalMetricPolicy";

describe("signalMetricPolicy", () => {
  it("uses evaluation time as delay fallback when the book snapshot predates the Binance move", () => {
    const timing = computeSignalTiming(1_000, 900, 1_350);

    expect(timing.polymarketDetectedAt).toBe(1_350);
    expect(timing.estimatedDelayMs).toBe(350);
  });

  it("uses the newer Polymarket book timestamp when it is already after the Binance move", () => {
    const timing = computeSignalTiming(1_000, 1_420, 1_500);

    expect(timing.polymarketDetectedAt).toBe(1_420);
    expect(timing.estimatedDelayMs).toBe(420);
  });

  it("suppresses signals when spread is clearly too wide", () => {
    const config = loadConfig();
    const decision = evaluateSignalNoise(config, {
      intervalMinutes: 15,
      priceReference: 0.5,
      spreadObservedBps: 174,
      binanceMoveBps: 80,
    });

    expect(decision.suppress).toBe(true);
    expect(decision.reason).toBe("spread_too_wide");
  });

  it("suppresses micro-moves that cannot clear current frictions", () => {
    const config = loadConfig();
    const decision = evaluateSignalNoise(config, {
      intervalMinutes: 15,
      priceReference: 0.5,
      spreadObservedBps: 40,
      binanceMoveBps: 8,
    });

    expect(decision.suppress).toBe(true);
    expect(decision.reason).toBe("move_below_viable_threshold");
    expect(decision.minimumViableMoveBps).toBeGreaterThan(8);
  });

  it("groups near-identical moves into the same dedup fingerprint bucket", () => {
    const first = buildSignalFingerprint({
      conditionId: "condition-1",
      outcome: "YES",
      binanceMoveBps: 8.1,
    });
    const second = buildSignalFingerprint({
      conditionId: "condition-1",
      outcome: "YES",
      binanceMoveBps: 8.9,
    });

    expect(first).toBe(second);
  });

  it("computes spread bps consistently from best bid and ask", () => {
    const spread = computeSpreadObserved(0.49, 0.5, 0.5);

    expect(spread.spreadObserved).toBeCloseTo(0.01);
    expect(spread.spreadObservedBps).toBeCloseTo(202.02, 1);
  });
});
