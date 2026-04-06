import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { MarketMetadata, OrderIntent, TradeSignal } from "../persistence/models";

export class EntryDecision {
  constructor(private readonly config: AppConfig) {}

  decide(signal: TradeSignal, market: MarketMetadata): OrderIntent | null {
    if (signal.status !== "approved") {
      return null;
    }

    return {
      signalId: signal.id,
      conditionId: signal.conditionId,
      marketId: market.marketId,
      assetId: signal.outcome === "YES" ? market.yesTokenId : market.noTokenId,
      intervalMinutes: market.intervalMinutes,
      outcome: signal.outcome,
      side: "BUY",
      price: signal.targetPrice,
      size: signal.executableSize,
      notional: signal.notional,
      tickSize: market.minimumTickSize,
      minOrderSize: market.minimumOrderSize,
      negRisk: market.negRisk,
      mode: this.config.execution.liveTrading ? "live" : "shadow",
      timeoutMs: this.config.execution.entryTimeoutMs,
      reason: `signal:${signal.id}:${randomUUID()}`,
    };
  }
}
