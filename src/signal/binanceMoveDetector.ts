import { AppConfig } from "../config/env";
import { BinanceMove, BinanceTick } from "../persistence/models";
import { calcBpsChange } from "../utils/math";

export class BinanceMoveDetector {
  private readonly ticks: BinanceTick[] = [];

  constructor(private readonly config: AppConfig) {}

  ingest(tick: BinanceTick): BinanceMove | null {
    this.ticks.push(tick);
    this.trim(tick.receivedAt);

    if (this.ticks.length < 2) {
      return null;
    }

    const start = this.ticks[0];
    const end = this.ticks[this.ticks.length - 1];
    const signedBps = calcBpsChange(start.price, end.price);
    const absoluteBps = Math.abs(signedBps);
    const startTimestamp = this.resolveTickTimestamp(start);
    const endTimestamp = this.resolveTickTimestamp(end);
    const windowMs = Math.max(1, endTimestamp - startTimestamp);
    const speedBpsPerSecond = absoluteBps / (windowMs / 1000);

    return {
      direction: absoluteBps < this.config.signal.binanceMinMoveBps ? "FLAT" : signedBps > 0 ? "UP" : "DOWN",
      absoluteBps,
      signedBps,
      speedBpsPerSecond,
      windowMs,
      startPrice: start.price,
      endPrice: end.price,
      startedAt: startTimestamp,
      endedAt: endTimestamp,
    };
  }

  latestPrice(): number | null {
    return this.ticks[this.ticks.length - 1]?.price ?? null;
  }

  private trim(now: number): void {
    const cutoff = now - this.config.signal.binanceMoveWindowMs;
    while (this.ticks.length > 0 && this.ticks[0].receivedAt < cutoff) {
      this.ticks.shift();
    }
  }

  private resolveTickTimestamp(tick: BinanceTick): number {
    return tick.tradeTime || tick.eventTime || tick.receivedAt;
  }
}
