import { randomUUID } from "node:crypto";
import { SqliteDb } from "../db";
import {
  BinanceTick,
  BotEvent,
  DiscoveredMarket,
  FillRecord,
  MarketMetadata,
  OrderRecord,
  PnlPoint,
  PnlSummary,
  PolymarketBookSnapshot,
  PositionRecord,
  SignalMetricsAnalysis,
  SignalMetricsBuckets,
  SignalMetricRecord,
  SignalMetricsSummary,
  TradeSignal,
} from "../models";

export class RuntimeRepository {
  constructor(private readonly db: SqliteDb) {}

  saveDiscoveredMarket(market: DiscoveredMarket): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO discovered_markets (
          condition_id, market_id, slug, question, interval_minutes, active, closed, discovered_at
        ) VALUES (
          @conditionId, @marketId, @slug, @question, @intervalMinutes, @active, @closed, @discoveredAt
        )
        ON CONFLICT(condition_id) DO UPDATE SET
          market_id = excluded.market_id,
          slug = excluded.slug,
          question = excluded.question,
          interval_minutes = excluded.interval_minutes,
          active = excluded.active,
          closed = excluded.closed,
          discovered_at = excluded.discovered_at
      `)
      .run({
        ...market,
        active: market.active ? 1 : 0,
        closed: market.closed ? 1 : 0,
      });
  }

  saveMarketMetadata(metadata: MarketMetadata): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO market_metadata (
          condition_id, market_id, slug, question, interval_minutes, yes_token_id, no_token_id,
          minimum_tick_size, minimum_order_size, taker_fee_bps, maker_fee_bps, active, closed,
          enable_order_book, neg_risk, last_discovered_at
        ) VALUES (
          @conditionId, @marketId, @slug, @question, @intervalMinutes, @yesTokenId, @noTokenId,
          @minimumTickSize, @minimumOrderSize, @takerFeeBps, @makerFeeBps, @active, @closed,
          @enableOrderBook, @negRisk, @lastDiscoveredAt
        )
        ON CONFLICT(condition_id) DO UPDATE SET
          market_id = excluded.market_id,
          slug = excluded.slug,
          question = excluded.question,
          interval_minutes = excluded.interval_minutes,
          yes_token_id = excluded.yes_token_id,
          no_token_id = excluded.no_token_id,
          minimum_tick_size = excluded.minimum_tick_size,
          minimum_order_size = excluded.minimum_order_size,
          taker_fee_bps = excluded.taker_fee_bps,
          maker_fee_bps = excluded.maker_fee_bps,
          active = excluded.active,
          closed = excluded.closed,
          enable_order_book = excluded.enable_order_book,
          neg_risk = excluded.neg_risk,
          last_discovered_at = excluded.last_discovered_at
      `)
      .run({
        ...metadata,
        active: metadata.active ? 1 : 0,
        closed: metadata.closed ? 1 : 0,
        enableOrderBook: metadata.enableOrderBook ? 1 : 0,
        negRisk: metadata.negRisk ? 1 : 0,
      });
  }

  saveBinanceTick(tick: BinanceTick): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO binance_ticks (
          symbol, trade_id, price, quantity, event_time, trade_time, market_maker, received_at
        ) VALUES (
          @symbol, @tradeId, @price, @quantity, @eventTime, @tradeTime, @marketMaker, @receivedAt
        )
      `)
      .run({
        ...tick,
        marketMaker: tick.marketMaker ? 1 : 0,
      });
  }

  saveBookSnapshot(snapshot: PolymarketBookSnapshot): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO polymarket_book_snapshots (
          condition_id, asset_id, outcome, best_bid, best_ask, midpoint, bids_json, asks_json,
          min_order_size, tick_size, book_timestamp, hash, received_at
        ) VALUES (
          @conditionId, @assetId, @outcome, @bestBid, @bestAsk, @midpoint, @bidsJson, @asksJson,
          @minOrderSize, @tickSize, @timestamp, @hash, @receivedAt
        )
      `)
      .run({
        ...snapshot,
        bidsJson: JSON.stringify(snapshot.bids),
        asksJson: JSON.stringify(snapshot.asks),
        hash: snapshot.hash ?? null,
      });
  }

  saveSignal(signal: TradeSignal): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO signals (
          id, condition_id, interval_minutes, outcome, side, reference_price, target_price,
          book_price, expected_probability, executable_size, depth_available, notional,
          gross_edge_bps, net_edge_bps, score, stale, status, reasons_json, move_json, created_at
        ) VALUES (
          @id, @conditionId, @intervalMinutes, @outcome, @side, @referencePrice, @targetPrice,
          @bookPrice, @expectedProbability, @executableSize, @depthAvailable, @notional,
          @grossEdgeBps, @netEdgeBps, @score, @stale, @status, @reasonsJson, @moveJson, @createdAt
        )
      `)
      .run({
        ...signal,
        stale: signal.stale ? 1 : 0,
        reasonsJson: JSON.stringify(signal.reasons),
        moveJson: JSON.stringify(signal.move),
      });
  }

  saveSignalMetric(metric: SignalMetricRecord): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO signal_metrics (
          signal_id, condition_id, market_label, interval_minutes, outcome, binance_move_detected_at,
          polymarket_detected_at, estimated_delay_ms, binance_move_bps, gross_edge_bps, net_edge_bps,
          spread_observed, spread_observed_bps, slippage_estimated_bps, depth_available, decision,
          skip_reason, created_at, updated_at
        ) VALUES (
          @signalId, @conditionId, @marketLabel, @intervalMinutes, @outcome, @binanceMoveDetectedAt,
          @polymarketDetectedAt, @estimatedDelayMs, @binanceMoveBps, @grossEdgeBps, @netEdgeBps,
          @spreadObserved, @spreadObservedBps, @slippageEstimatedBps, @depthAvailable, @decision,
          @skipReason, @createdAt, @updatedAt
        )
        ON CONFLICT(signal_id) DO UPDATE SET
          condition_id = excluded.condition_id,
          market_label = excluded.market_label,
          interval_minutes = excluded.interval_minutes,
          outcome = excluded.outcome,
          binance_move_detected_at = excluded.binance_move_detected_at,
          polymarket_detected_at = excluded.polymarket_detected_at,
          estimated_delay_ms = excluded.estimated_delay_ms,
          binance_move_bps = excluded.binance_move_bps,
          gross_edge_bps = excluded.gross_edge_bps,
          net_edge_bps = excluded.net_edge_bps,
          spread_observed = excluded.spread_observed,
          spread_observed_bps = excluded.spread_observed_bps,
          slippage_estimated_bps = excluded.slippage_estimated_bps,
          depth_available = excluded.depth_available,
          decision = excluded.decision,
          skip_reason = excluded.skip_reason,
          updated_at = excluded.updated_at
      `)
      .run(metric);
  }

  upsertOrder(order: OrderRecord): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO orders (
          id, signal_id, position_id, condition_id, asset_id, outcome, side, mode, price, size,
          filled_size, status, external_order_id, reject_reason, created_at, updated_at
        ) VALUES (
          @id, @signalId, @positionId, @conditionId, @assetId, @outcome, @side, @mode, @price, @size,
          @filledSize, @status, @externalOrderId, @rejectReason, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          signal_id = excluded.signal_id,
          position_id = excluded.position_id,
          condition_id = excluded.condition_id,
          asset_id = excluded.asset_id,
          outcome = excluded.outcome,
          side = excluded.side,
          mode = excluded.mode,
          price = excluded.price,
          size = excluded.size,
          filled_size = excluded.filled_size,
          status = excluded.status,
          external_order_id = excluded.external_order_id,
          reject_reason = excluded.reject_reason,
          updated_at = excluded.updated_at
      `)
      .run(order);
  }

  saveFill(fill: FillRecord): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO fills (
          id, order_id, position_id, condition_id, asset_id, outcome, side, price, size, fee,
          mode, external_trade_id, filled_at
        ) VALUES (
          @id, @orderId, @positionId, @conditionId, @assetId, @outcome, @side, @price, @size, @fee,
          @mode, @externalTradeId, @filledAt
        )
      `)
      .run(fill);
  }

  upsertPosition(position: PositionRecord): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO positions (
          id, condition_id, market_id, asset_id, interval_minutes, outcome, status, entry_price,
          current_price, size, entry_notional, realized_pnl, unrealized_pnl, opened_at, updated_at,
          closed_at, exit_reason
        ) VALUES (
          @id, @conditionId, @marketId, @assetId, @intervalMinutes, @outcome, @status, @entryPrice,
          @currentPrice, @size, @entryNotional, @realizedPnl, @unrealizedPnl, @openedAt, @updatedAt,
          @closedAt, @exitReason
        )
        ON CONFLICT(id) DO UPDATE SET
          condition_id = excluded.condition_id,
          market_id = excluded.market_id,
          asset_id = excluded.asset_id,
          interval_minutes = excluded.interval_minutes,
          outcome = excluded.outcome,
          status = excluded.status,
          entry_price = excluded.entry_price,
          current_price = excluded.current_price,
          size = excluded.size,
          entry_notional = excluded.entry_notional,
          realized_pnl = excluded.realized_pnl,
          unrealized_pnl = excluded.unrealized_pnl,
          updated_at = excluded.updated_at,
          closed_at = excluded.closed_at,
          exit_reason = excluded.exit_reason
      `)
      .run(position);
  }

  savePnlPoint(point: PnlPoint): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO pnl_timeseries (timestamp, realized_pnl, unrealized_pnl, total_pnl)
        VALUES (@timestamp, @realizedPnl, @unrealizedPnl, @totalPnl)
      `)
      .run(point);
  }

  saveEvent(event: BotEvent): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO bot_events (id, level, category, message, context_json, created_at)
        VALUES (@id, @level, @category, @message, @contextJson, @createdAt)
      `)
      .run({
        ...event,
        contextJson: JSON.stringify(event.context),
      });
  }

  saveConfigSnapshot(payload: Record<string, unknown>): void {
    this.db.sqlite
      .prepare(`
        INSERT INTO config_snapshots (id, payload_json, created_at)
        VALUES (@id, @payloadJson, @createdAt)
      `)
      .run({
        id: randomUUID(),
        payloadJson: JSON.stringify(payload),
        createdAt: Date.now(),
      });
  }

  listMarketMetadata(): MarketMetadata[] {
    const rows = this.db.sqlite.prepare(`SELECT * FROM market_metadata ORDER BY interval_minutes ASC`).all();
    return rows.map((row: any) => ({
      conditionId: row.condition_id,
      marketId: row.market_id,
      slug: row.slug,
      question: row.question,
      intervalMinutes: row.interval_minutes,
      yesTokenId: row.yes_token_id,
      noTokenId: row.no_token_id,
      minimumTickSize: row.minimum_tick_size,
      minimumOrderSize: row.minimum_order_size,
      takerFeeBps: row.taker_fee_bps,
      makerFeeBps: row.maker_fee_bps,
      active: Boolean(row.active),
      closed: Boolean(row.closed),
      enableOrderBook: Boolean(row.enable_order_book),
      negRisk: Boolean(row.neg_risk),
      lastDiscoveredAt: row.last_discovered_at,
    }));
  }

  listOpenPositions(): PositionRecord[] {
    const rows = this.db.sqlite.prepare(`SELECT * FROM positions WHERE status = 'OPEN' ORDER BY opened_at ASC`).all();
    return rows.map((row: any) => ({
      id: row.id,
      conditionId: row.condition_id,
      marketId: row.market_id,
      assetId: row.asset_id,
      intervalMinutes: row.interval_minutes,
      outcome: row.outcome,
      status: row.status,
      entryPrice: row.entry_price,
      currentPrice: row.current_price,
      size: row.size,
      entryNotional: row.entry_notional,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      openedAt: row.opened_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      exitReason: row.exit_reason,
    }));
  }

  listRecentSignals(limit = 20): TradeSignal[] {
    const rows = this.db.sqlite
      .prepare(`SELECT * FROM signals ORDER BY created_at DESC LIMIT ?`)
      .all(limit);

    return rows.map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      conditionId: row.condition_id,
      intervalMinutes: row.interval_minutes,
      outcome: row.outcome,
      side: row.side,
      referencePrice: row.reference_price,
      targetPrice: row.target_price,
      bookPrice: row.book_price,
      expectedProbability: row.expected_probability,
      executableSize: row.executable_size,
      depthAvailable: row.depth_available,
      notional: row.notional,
      grossEdgeBps: row.gross_edge_bps,
      netEdgeBps: row.net_edge_bps,
      score: row.score,
      stale: Boolean(row.stale),
      status: row.status,
      reasons: JSON.parse(row.reasons_json),
      move: JSON.parse(row.move_json),
      bestBid: null,
      bestAsk: null,
    }));
  }

  listOpenOrders(): OrderRecord[] {
    const rows = this.db.sqlite
      .prepare(`SELECT * FROM orders WHERE status IN ('NEW', 'OPEN', 'PARTIAL') ORDER BY created_at ASC`)
      .all();

    return rows.map((row: any) => ({
      id: row.id,
      signalId: row.signal_id,
      positionId: row.position_id,
      conditionId: row.condition_id,
      assetId: row.asset_id,
      outcome: row.outcome,
      side: row.side,
      mode: row.mode,
      price: row.price,
      size: row.size,
      filledSize: row.filled_size,
      status: row.status,
      externalOrderId: row.external_order_id,
      rejectReason: row.reject_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  listSignalMetrics(limit = 100): SignalMetricRecord[] {
    const rows = this.db.sqlite.prepare(`SELECT * FROM signal_metrics ORDER BY created_at DESC LIMIT ?`).all(limit);
    return rows.map((row: any) => this.mapSignalMetricRow(row));
  }

  getSignalMetricsSummary(): SignalMetricsSummary {
    const metrics = this.listAllSignalMetrics();
    const distributionByMarket: SignalMetricsSummary["distributionByMarket"] = {};
    const distributionBySkipReason: Record<string, number> = {};

    let grossEdgeSum = 0;
    let netEdgeSum = 0;
    let delaySum = 0;
    let entered = 0;
    let skipped = 0;
    let minCreatedAt = Number.POSITIVE_INFINITY;
    let maxCreatedAt = 0;

    for (const metric of metrics) {
      grossEdgeSum += metric.grossEdgeBps;
      netEdgeSum += metric.netEdgeBps;
      delaySum += metric.estimatedDelayMs;
      minCreatedAt = Math.min(minCreatedAt, metric.createdAt);
      maxCreatedAt = Math.max(maxCreatedAt, metric.createdAt);

      if (!distributionByMarket[metric.marketLabel]) {
        distributionByMarket[metric.marketLabel] = {
          total: 0,
          entered: 0,
          skipped: 0,
          avgNetEdgeBps: 0,
          medianNetEdgeBps: 0,
          avgDelayMs: 0,
          medianDelayMs: 0,
        };
      }

      distributionByMarket[metric.marketLabel].total += 1;

      if (metric.decision === "entered") {
        entered += 1;
        distributionByMarket[metric.marketLabel].entered += 1;
      } else {
        skipped += 1;
        distributionByMarket[metric.marketLabel].skipped += 1;
        const reason = metric.skipReason ?? "unspecified";
        distributionBySkipReason[reason] = (distributionBySkipReason[reason] ?? 0) + 1;
      }
    }

    for (const [marketLabel, bucket] of Object.entries(distributionByMarket)) {
      const marketMetrics = metrics.filter((metric) => metric.marketLabel === marketLabel);
      bucket.avgNetEdgeBps = mean(marketMetrics.map((metric) => metric.netEdgeBps));
      bucket.medianNetEdgeBps = median(marketMetrics.map((metric) => metric.netEdgeBps));
      bucket.avgDelayMs = mean(marketMetrics.map((metric) => metric.estimatedDelayMs));
      bucket.medianDelayMs = median(marketMetrics.map((metric) => metric.estimatedDelayMs));
    }

    const winLossRow = this.db.sqlite
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'CLOSED' THEN realized_pnl ELSE 0 END), 0) AS total_realized_pnl,
          COALESCE(SUM(CASE WHEN status = 'CLOSED' AND realized_pnl > 0 THEN 1 ELSE 0 END), 0) AS wins,
          COALESCE(SUM(CASE WHEN status = 'CLOSED' AND realized_pnl <= 0 THEN 1 ELSE 0 END), 0) AS losses
        FROM positions
      `)
      .get() as any;

    const totalSignals = metrics.length;
    const observedHours = calculateObservedHours(minCreatedAt, maxCreatedAt, totalSignals);
    const closedTrades = winLossRow.wins + winLossRow.losses;
    const topSkipReasons = Object.entries(distributionBySkipReason)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    return {
      totalSignals,
      signalsExecuted: entered,
      signalsDiscarded: skipped,
      signalsPerHour: observedHours > 0 ? Number((totalSignals / observedHours).toFixed(2)) : 0,
      enteredRate: totalSignals > 0 ? Number((entered / totalSignals).toFixed(4)) : 0,
      skipRate: totalSignals > 0 ? Number((skipped / totalSignals).toFixed(4)) : 0,
      simulatedWins: winLossRow.wins,
      simulatedLosses: winLossRow.losses,
      simulatedWinRate: closedTrades > 0 ? Number((winLossRow.wins / closedTrades).toFixed(4)) : 0,
      simulatedLossRate: closedTrades > 0 ? Number((winLossRow.losses / closedTrades).toFixed(4)) : 0,
      avgGrossEdgeBps: totalSignals > 0 ? Number((grossEdgeSum / totalSignals).toFixed(2)) : 0,
      avgNetEdgeBps: totalSignals > 0 ? Number((netEdgeSum / totalSignals).toFixed(2)) : 0,
      avgEstimatedDelayMs: totalSignals > 0 ? Number((delaySum / totalSignals).toFixed(2)) : 0,
      expectancyPerSignal: totalSignals > 0 ? Number((winLossRow.total_realized_pnl / totalSignals).toFixed(6)) : 0,
      expectancyPerExecutedTrade: entered > 0 ? Number((winLossRow.total_realized_pnl / entered).toFixed(6)) : 0,
      distributionByMarket,
      distributionBySkipReason,
      topSkipReasons,
    };
  }

  getSignalMetricsBuckets(): SignalMetricsBuckets {
    const metrics = this.listAllSignalMetrics();

    return {
      binanceMoveBps: bucketize(metrics, [
        { label: "<10bps", min: Number.NEGATIVE_INFINITY, max: 10, selector: (metric) => metric.binanceMoveBps },
        { label: "10-20bps", min: 10, max: 20, selector: (metric) => metric.binanceMoveBps },
        { label: "20-40bps", min: 20, max: 40, selector: (metric) => metric.binanceMoveBps },
        { label: "40-80bps", min: 40, max: 80, selector: (metric) => metric.binanceMoveBps },
        { label: ">=80bps", min: 80, max: Number.POSITIVE_INFINITY, selector: (metric) => metric.binanceMoveBps },
      ]),
      estimatedDelayMs: bucketize(metrics, [
        { label: "<250ms", min: Number.NEGATIVE_INFINITY, max: 250, selector: (metric) => metric.estimatedDelayMs },
        { label: "250-500ms", min: 250, max: 500, selector: (metric) => metric.estimatedDelayMs },
        { label: "500-1000ms", min: 500, max: 1000, selector: (metric) => metric.estimatedDelayMs },
        { label: "1000-2000ms", min: 1000, max: 2000, selector: (metric) => metric.estimatedDelayMs },
        { label: ">=2000ms", min: 2000, max: Number.POSITIVE_INFINITY, selector: (metric) => metric.estimatedDelayMs },
      ]),
      netEdgeBps: bucketize(metrics, [
        { label: "<0bps", min: Number.NEGATIVE_INFINITY, max: 0, selector: (metric) => metric.netEdgeBps },
        { label: "0-10bps", min: 0, max: 10, selector: (metric) => metric.netEdgeBps },
        { label: "10-20bps", min: 10, max: 20, selector: (metric) => metric.netEdgeBps },
        { label: "20-40bps", min: 20, max: 40, selector: (metric) => metric.netEdgeBps },
        { label: ">=40bps", min: 40, max: Number.POSITIVE_INFINITY, selector: (metric) => metric.netEdgeBps },
      ]),
    };
  }

  getSignalMetricsAnalysis(): SignalMetricsAnalysis {
    const summary = this.getSignalMetricsSummary();
    const metrics = this.listAllSignalMetrics();
    const observedHours = metrics.length > 0
      ? calculateObservedHours(
          Math.min(...metrics.map((metric) => metric.createdAt)),
          Math.max(...metrics.map((metric) => metric.createdAt)),
          metrics.length,
        )
      : 0;

    let interpretation: SignalMetricsAnalysis["interpretation"] = "insuficiente data";
    const notes: string[] = [];

    if (observedHours < 2 || summary.totalSignals < 20) {
      interpretation = "insuficiente data";
      notes.push("Menos de 2 horas de observacion o menos de 20 senales.");
    } else if (
      summary.avgNetEdgeBps >= 10 &&
      summary.enteredRate >= 0.1 &&
      summary.expectancyPerExecutedTrade > 0 &&
      (summary.simulatedWinRate >= 0.5 || summary.simulatedWins + summary.simulatedLosses < 5)
    ) {
      interpretation = "edge prometedor";
      notes.push("Net edge medio positivo, tasa de entrada util y expectancy positiva.");
    } else {
      interpretation = "edge debil";
      notes.push("Hay datos suficientes, pero el net edge o la expectancy no destacan.");
    }

    const sortedMarkets = Object.entries(summary.distributionByMarket)
      .sort((a, b) => b[1].avgNetEdgeBps - a[1].avgNetEdgeBps);

    return {
      interpretation,
      observedHours: Number(observedHours.toFixed(2)),
      totalSignals: summary.totalSignals,
      signalsPerHour: summary.signalsPerHour,
      enteredRate: summary.enteredRate,
      skipRate: summary.skipRate,
      avgNetEdgeBps: summary.avgNetEdgeBps,
      expectancyPerSignal: summary.expectancyPerSignal,
      expectancyPerExecutedTrade: summary.expectancyPerExecutedTrade,
      simulatedWinRate: summary.simulatedWinRate,
      simulatedLossRate: summary.simulatedLossRate,
      strongestMarket: sortedMarkets[0]?.[0] ?? null,
      weakestMarket: sortedMarkets.at(-1)?.[0] ?? null,
      notes,
    };
  }

  getPnlSummary(): PnlSummary {
    const row = this.db.sqlite
      .prepare(`
        SELECT
          COALESCE(SUM(realized_pnl), 0) AS realized_pnl,
          COALESCE(SUM(CASE WHEN status = 'OPEN' THEN unrealized_pnl ELSE 0 END), 0) AS unrealized_pnl,
          COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) AS open_positions
        FROM positions
      `)
      .get() as any;

    return {
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      totalPnl: row.realized_pnl + row.unrealized_pnl,
      openPositions: row.open_positions,
    };
  }

  private listAllSignalMetrics(): SignalMetricRecord[] {
    const rows = this.db.sqlite.prepare(`SELECT * FROM signal_metrics ORDER BY created_at DESC`).all();
    return rows.map((row: any) => this.mapSignalMetricRow(row));
  }

  private mapSignalMetricRow(row: any): SignalMetricRecord {
    return {
      signalId: row.signal_id,
      conditionId: row.condition_id,
      marketLabel: row.market_label,
      intervalMinutes: row.interval_minutes,
      outcome: row.outcome,
      binanceMoveDetectedAt: row.binance_move_detected_at,
      polymarketDetectedAt: row.polymarket_detected_at,
      estimatedDelayMs: row.estimated_delay_ms,
      binanceMoveBps: row.binance_move_bps,
      grossEdgeBps: row.gross_edge_bps,
      netEdgeBps: row.net_edge_bps,
      spreadObserved: row.spread_observed,
      spreadObservedBps: row.spread_observed_bps,
      slippageEstimatedBps: row.slippage_estimated_bps,
      depthAvailable: row.depth_available,
      decision: row.decision,
      skipReason: row.skip_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return Number(value.toFixed(2));
}

function calculateObservedHours(minCreatedAt: number, maxCreatedAt: number, totalSignals: number): number {
  if (!Number.isFinite(minCreatedAt) || totalSignals === 0) {
    return 0;
  }

  const rawHours = maxCreatedAt > minCreatedAt ? (maxCreatedAt - minCreatedAt) / 3_600_000 : 1 / 60;
  return Math.max(rawHours, 1 / 60);
}

function bucketize(
  metrics: SignalMetricRecord[],
  definitions: Array<{
    label: string;
    min: number;
    max: number;
    selector: (metric: SignalMetricRecord) => number;
  }>,
) {
  return definitions.map((definition) => {
    const bucketMetrics = metrics.filter((metric) => {
      const value = definition.selector(metric);
      return value >= definition.min && value < definition.max;
    });

    const entered = bucketMetrics.filter((metric) => metric.decision === "entered").length;
    const skipped = bucketMetrics.length - entered;

    return {
      bucket: definition.label,
      total: bucketMetrics.length,
      entered,
      skipped,
      avgNetEdgeBps: mean(bucketMetrics.map((metric) => metric.netEdgeBps)),
    };
  });
}
