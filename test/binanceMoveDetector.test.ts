import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env";
import { BinanceMoveDetector } from "../src/signal/binanceMoveDetector";

describe("BinanceMoveDetector", () => {
  it("computes an UP move across the configured window", () => {
    const config = loadConfig({
      BINANCE_MOVE_WINDOW_MS: "3000",
      BINANCE_MIN_MOVE_BPS: "5",
    });
    const detector = new BinanceMoveDetector(config);

    detector.ingest({
      symbol: "BTCUSDT",
      tradeId: "1",
      price: 100000,
      quantity: 0.1,
      eventTime: 1,
      tradeTime: 1,
      marketMaker: false,
      receivedAt: 1_000,
    });

    const move = detector.ingest({
      symbol: "BTCUSDT",
      tradeId: "2",
      price: 100150,
      quantity: 0.2,
      eventTime: 2,
      tradeTime: 2,
      marketMaker: false,
      receivedAt: 3_000,
    });

    expect(move).not.toBeNull();
    expect(move?.direction).toBe("UP");
    expect(move?.absoluteBps).toBeGreaterThan(10);
    expect(move?.speedBpsPerSecond).toBeGreaterThan(5);
  });
});
