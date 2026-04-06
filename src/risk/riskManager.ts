import { AppConfig } from "../config/env";
import { ConnectionHealth, MarketMetadata, OrderRecord, PnlSummary, PositionRecord, TradeSignal } from "../persistence/models";
import { ExposureManager } from "./exposureManager";
import { KillSwitch } from "./killSwitch";

export interface EntryRiskContext {
  signal: TradeSignal;
  market: MarketMetadata;
  positions: PositionRecord[];
  openOrders: OrderRecord[];
  binanceHealth: ConnectionHealth;
  polymarketHealth: ConnectionHealth;
  pnlSummary: PnlSummary;
}

export interface RiskDecision {
  allowed: boolean;
  reason: string | null;
}

export class RiskManager {
  constructor(
    private readonly config: AppConfig,
    private readonly exposureManager: ExposureManager,
    private readonly killSwitch: KillSwitch,
  ) {}

  evaluateEntry(context: EntryRiskContext): RiskDecision {
    if (this.killSwitch.isActive()) {
      return { allowed: false, reason: "kill_switch_active" };
    }

    if (!context.binanceHealth.connected) {
      return { allowed: false, reason: "binance_ws_down" };
    }

    if (!context.polymarketHealth.connected) {
      return { allowed: false, reason: "polymarket_ws_down" };
    }

    if (context.signal.stale) {
      return { allowed: false, reason: "stale_book" };
    }

    if (context.signal.executableSize < context.market.minimumOrderSize) {
      return { allowed: false, reason: "below_min_order_size" };
    }

    if (context.signal.targetPrice <= 0 || context.signal.targetPrice >= 1) {
      return { allowed: false, reason: "invalid_tick_or_price" };
    }

    if (context.openOrders.length >= this.config.risk.maxSimultaneousOrders) {
      return { allowed: false, reason: "too_many_open_orders" };
    }

    const openPositionsInMarket = this.exposureManager.countPositionsForMarket(context.market.conditionId, context.positions);
    if (openPositionsInMarket >= this.config.risk.maxOpenPositionsPerMarket) {
      return { allowed: false, reason: "too_many_positions_in_market" };
    }

    const totalExposure = this.exposureManager.totalExposure(context.positions, context.openOrders);
    if (totalExposure + context.signal.notional > this.config.risk.maxTotalExposure) {
      return { allowed: false, reason: "max_total_exposure_reached" };
    }

    if (context.pnlSummary.totalPnl <= -Math.abs(this.config.risk.maxDrawdownDaily)) {
      return { allowed: false, reason: "daily_drawdown_limit" };
    }

    return { allowed: true, reason: null };
  }

  checkForKill(pnlSummary: PnlSummary): string | null {
    if (pnlSummary.totalPnl <= -Math.abs(this.config.risk.maxDrawdownDaily)) {
      return "daily_drawdown_limit";
    }

    return null;
  }
}
