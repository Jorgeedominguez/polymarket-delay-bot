import { AppConfig } from "../config/env";
import { BinanceMove, OrderIntent, PolymarketBookSnapshot, PositionRecord } from "../persistence/models";
import { roundDownToTick } from "../utils/math";

export interface ExitPlan {
  shouldExit: boolean;
  reason: string;
  price: number;
}

export class ExitDecision {
  constructor(private readonly config: AppConfig) {}

  evaluate(
    position: PositionRecord,
    book: PolymarketBookSnapshot | undefined,
    latestMove: BinanceMove | null,
  ): ExitPlan | null {
    if (!book || book.bestBid == null) {
      return null;
    }

    const markPrice = book.bestBid;
    const pnlBps = ((markPrice - position.entryPrice) / position.entryPrice) * 10_000;
    const ageMs = Date.now() - position.openedAt;

    if (pnlBps >= this.config.execution.takeProfitBps) {
      return {
        shouldExit: true,
        reason: "take_profit",
        price: roundDownToTick(markPrice, book.tickSize),
      };
    }

    if (pnlBps <= -this.config.execution.stopLossBps) {
      return {
        shouldExit: true,
        reason: "stop_loss",
        price: roundDownToTick(markPrice, book.tickSize),
      };
    }

    if (ageMs >= this.config.execution.exitTimeoutMs) {
      return {
        shouldExit: true,
        reason: "timeout",
        price: roundDownToTick(markPrice, book.tickSize),
      };
    }

    if (latestMove) {
      const invalidated =
        (position.outcome === "YES" && latestMove.direction === "DOWN" && latestMove.absoluteBps >= this.config.signal.binanceMinMoveBps) ||
        (position.outcome === "NO" && latestMove.direction === "UP" && latestMove.absoluteBps >= this.config.signal.binanceMinMoveBps);

      if (invalidated) {
        return {
          shouldExit: true,
          reason: "edge_invalidated",
          price: roundDownToTick(markPrice, book.tickSize),
        };
      }
    }

    return {
      shouldExit: false,
      reason: "hold",
      price: roundDownToTick(markPrice, book.tickSize),
    };
  }

  toExitIntent(
    position: PositionRecord,
    book: PolymarketBookSnapshot,
    reason: string,
  ): OrderIntent {
    return {
      signalId: `exit:${position.id}`,
      conditionId: position.conditionId,
      marketId: position.marketId,
      assetId: position.assetId,
      positionId: position.id,
      intervalMinutes: position.intervalMinutes,
      outcome: position.outcome,
      side: "SELL",
      price: roundDownToTick(book.bestBid ?? position.entryPrice, book.tickSize),
      size: position.size,
      notional: position.size * (book.bestBid ?? position.entryPrice),
      tickSize: book.tickSize,
      minOrderSize: book.minOrderSize,
      negRisk: false,
      mode: this.config.execution.liveTrading ? "live" : "shadow",
      timeoutMs: this.config.execution.entryTimeoutMs,
      reason,
    };
  }
}
