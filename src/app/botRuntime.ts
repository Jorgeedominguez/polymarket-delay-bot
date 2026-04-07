import { randomUUID } from "node:crypto";
import { Logger } from "pino";
import { AppConfig } from "../config/env";
import { BinanceWsClient } from "../clients/binanceWsClient";
import { PolymarketWsMarketClient } from "../clients/polymarketWsMarketClient";
import { PolymarketWsUserClient } from "../clients/polymarketWsUserClient";
import { TelegramClient } from "../clients/telegramClient";
import { BtcPolymarketDiscovery } from "../discovery/btcPolymarketDiscovery";
import { CancelManager } from "../execution/cancelManager";
import { ExecutionResult, OrderExecutor } from "../execution/orderExecutor";
import { OrderManager } from "../execution/orderManager";
import { PositionManager } from "../execution/positionManager";
import {
  BinanceMove,
  BinanceTick,
  BotLifecycleState,
  FillRecord,
  MarketMetadata,
  OrderIntent,
  OrderStatus,
  PolymarketBookSnapshot,
  PositionRecord,
  RuntimeStatus,
  SignalMetricRecord,
  SignalMetricsSummary,
  TradeSignal,
} from "../persistence/models";
import { RuntimeRepository } from "../persistence/repositories/runtimeRepository";
import { RiskManager } from "../risk/riskManager";
import { BinanceMoveDetector } from "../signal/binanceMoveDetector";
import { SignalEngine } from "../signal/signalEngine";
import {
  buildSignalFingerprint,
  computeSignalTiming,
  computeSpreadObserved,
  evaluateSignalNoise,
  SIGNAL_DEDUP_WINDOW_MS,
} from "../signal/signalMetricPolicy";
import { EntryDecision } from "../strategy/entryDecision";
import { ExitDecision } from "../strategy/exitDecision";
import { formatUsd } from "../utils/math";

interface BotRuntimeDeps {
  config: AppConfig;
  logger: Logger;
  repository: RuntimeRepository;
  discovery: BtcPolymarketDiscovery;
  telegram: TelegramClient;
  binanceWs: BinanceWsClient;
  polymarketWs: PolymarketWsMarketClient;
  polymarketUserWs: PolymarketWsUserClient;
  moveDetector: BinanceMoveDetector;
  signalEngine: SignalEngine;
  entryDecision: EntryDecision;
  exitDecision: ExitDecision;
  riskManager: RiskManager;
  orderExecutor: OrderExecutor;
  orderManager: OrderManager;
  positionManager: PositionManager;
  cancelManager: CancelManager;
}

interface SignalScanSummary {
  moveBps: number;
  discoveredByInterval: Record<5 | 15, number>;
  withBooksByInterval: Record<5 | 15, number>;
  producedByInterval: Record<5 | 15, number>;
  persistedByInterval: Record<5 | 15, number>;
  suppressedByInterval: Record<5 | 15, number>;
  suppressedReasons: Record<string, number>;
}

export class BotRuntime {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly repository: RuntimeRepository;
  private readonly discovery: BtcPolymarketDiscovery;
  private readonly telegram: TelegramClient;
  private readonly binanceWs: BinanceWsClient;
  private readonly polymarketWs: PolymarketWsMarketClient;
  private readonly polymarketUserWs: PolymarketWsUserClient;
  private readonly moveDetector: BinanceMoveDetector;
  private readonly signalEngine: SignalEngine;
  private readonly entryDecision: EntryDecision;
  private readonly exitDecision: ExitDecision;
  private readonly riskManager: RiskManager;
  private readonly orderExecutor: OrderExecutor;
  private readonly orderManager: OrderManager;
  private readonly positionManager: PositionManager;
  private readonly cancelManager: CancelManager;

  private state: BotLifecycleState = "stopped";
  private startedAt: number | null = null;
  private pausedReason: string | null = null;
  private killReason: string | null = null;
  private latestMove: BinanceMove | null = null;
  private readonly marketByConditionId = new Map<string, MarketMetadata>();
  private readonly booksByAssetId = new Map<string, PolymarketBookSnapshot>();
  private readonly recentSignalFingerprints = new Map<string, number>();
  private lastSignalScanLogAt = 0;

  constructor(deps: BotRuntimeDeps) {
    this.config = deps.config;
    this.logger = deps.logger;
    this.repository = deps.repository;
    this.discovery = deps.discovery;
    this.telegram = deps.telegram;
    this.binanceWs = deps.binanceWs;
    this.polymarketWs = deps.polymarketWs;
    this.polymarketUserWs = deps.polymarketUserWs;
    this.moveDetector = deps.moveDetector;
    this.signalEngine = deps.signalEngine;
    this.entryDecision = deps.entryDecision;
    this.exitDecision = deps.exitDecision;
    this.riskManager = deps.riskManager;
    this.orderExecutor = deps.orderExecutor;
    this.orderManager = deps.orderManager;
    this.positionManager = deps.positionManager;
    this.cancelManager = deps.cancelManager;
  }

  async initialize(): Promise<void> {
    this.repository.saveConfigSnapshot({
      execution: this.config.execution,
      risk: this.config.risk,
      signal: this.config.signal,
    });

    this.orderManager.hydrate(this.repository.listOpenOrders());
    this.positionManager.hydrate(this.repository.listOpenPositions());

    await this.refreshDiscovery();
    await this.notify("system", "Servicio online. Estado inicial: stopped.");
  }

  startInfrastructure(): void {
    this.binanceWs.start();
    this.polymarketWs.start();
    this.polymarketUserWs.start();
  }

  async refreshDiscovery(): Promise<void> {
    const result = await this.discovery.discover();
    const newMarkets: MarketMetadata[] = [];

    for (const discovered of result.discovered) {
      this.repository.saveDiscoveredMarket(discovered);
    }

    for (const metadata of result.metadata) {
      const isNew = !this.marketByConditionId.has(metadata.conditionId);
      this.marketByConditionId.set(metadata.conditionId, metadata);
      this.repository.saveMarketMetadata(metadata);
      if (isNew) {
        newMarkets.push(metadata);
      }
    }

    this.polymarketWs.registerMarkets(result.metadata);
    this.polymarketWs.subscribeAssets(result.metadata.flatMap((market) => [market.yesTokenId, market.noTokenId]));
    this.polymarketUserWs.setMarketFilters(result.metadata.map((market) => market.conditionId));

    for (const market of newMarkets) {
      await this.notify("discovery", `Mercado descubierto: BTC ${market.intervalMinutes}m | ${market.question}`);
    }
  }

  async startBot(): Promise<string> {
    if (this.state === "killed") {
      return "Bot en estado killed. Reinicia el proceso para volver a habilitar trading.";
    }

    this.state = "running";
    this.startedAt ??= Date.now();
    this.pausedReason = null;
    await this.notify("control", "Bot iniciado");
    return "Bot iniciado";
  }

  async pauseBot(reason = "manual"): Promise<string> {
    if (this.state === "killed") {
      return "Bot ya esta killed.";
    }

    this.state = "paused";
    this.pausedReason = reason;
    await this.notify("control", `Bot pausado (${reason})`);
    return `Bot pausado (${reason})`;
  }

  async resumeBot(): Promise<string> {
    if (this.state === "killed") {
      return "Bot en killed. No se puede reanudar sin reiniciar.";
    }

    this.state = "running";
    this.pausedReason = null;
    await this.notify("control", "Bot reanudado");
    return "Bot reanudado";
  }

  async killBot(reason = "manual"): Promise<string> {
    this.state = "killed";
    this.killReason = reason;
    await this.cancelManager.cancelAllOpenOrders(reason);
    await this.notify("control", `Kill switch activado (${reason})`, "WARN");
    return `Kill switch activado (${reason})`;
  }

  getStatus(): RuntimeStatus {
    return {
      state: this.state,
      startedAt: this.startedAt,
      pausedReason: this.pausedReason,
      killReason: this.killReason,
      shadowMode: this.config.execution.shadowMode,
      liveTrading: this.config.execution.liveTrading,
      binance: this.binanceWs.getHealth(),
      polymarketMarketWs: this.polymarketWs.getHealth(),
      polymarketUserWs: this.polymarketUserWs.getHealth(),
      discoveredMarkets: this.marketByConditionId.size,
      openOrders: this.orderManager.getOpenOrders().length,
      pnl: this.repository.getPnlSummary(),
    };
  }

  getMarkets(): Array<Record<string, unknown>> {
    return [...this.marketByConditionId.values()].map((market) => ({
      conditionId: market.conditionId,
      question: market.question,
      intervalMinutes: market.intervalMinutes,
      yesBook: this.booksByAssetId.get(market.yesTokenId),
      noBook: this.booksByAssetId.get(market.noTokenId),
    }));
  }

  getPositions(): PositionRecord[] {
    return this.positionManager.getOpenPositions();
  }

  getRecentSignals(): TradeSignal[] {
    return this.repository.listRecentSignals();
  }

  getSignalMetrics(): SignalMetricRecord[] {
    return this.repository.listSignalMetrics();
  }

  getSignalMetricsSummary(): SignalMetricsSummary {
    return this.repository.getSignalMetricsSummary();
  }

  getSignalMetricsAnalysis() {
    return this.repository.getSignalMetricsAnalysis();
  }

  getSignalMetricsBuckets() {
    return this.repository.getSignalMetricsBuckets();
  }

  getConfigSummary(): Record<string, unknown> {
    return {
      execution: this.config.execution,
      risk: this.config.risk,
      signal: this.config.signal,
      polymarket: {
        host: this.config.polymarket.host,
        chainId: this.config.polymarket.chainId,
        signatureType: this.config.polymarket.signatureType,
        hasPrivateKey: Boolean(this.config.polymarket.privateKey),
        hasApiKey: Boolean(this.config.polymarket.apiKey),
        hasApiSecret: Boolean(this.config.polymarket.apiSecret),
        hasApiPassphrase: Boolean(this.config.polymarket.apiPassphrase),
        hasFunderAddress: Boolean(this.config.polymarket.funderAddress),
      },
    };
  }

  async onBinanceTick(tick: BinanceTick): Promise<void> {
    this.repository.saveBinanceTick(tick);
    this.latestMove = this.moveDetector.ingest(tick);

    if (this.state !== "running") {
      return;
    }

    const scanSummary: SignalScanSummary = {
      moveBps: this.latestMove?.absoluteBps ?? 0,
      discoveredByInterval: { 5: 0, 15: 0 },
      withBooksByInterval: { 5: 0, 15: 0 },
      producedByInterval: { 5: 0, 15: 0 },
      persistedByInterval: { 5: 0, 15: 0 },
      suppressedByInterval: { 5: 0, 15: 0 },
      suppressedReasons: {},
    };

    for (const market of this.marketByConditionId.values()) {
      scanSummary.discoveredByInterval[market.intervalMinutes] += 1;
      const positions = this.positionManager.getOpenPositions();
      const openOrders = this.orderManager.getOpenOrders();
      const pnlSummary = this.repository.getPnlSummary();
      const yesBook = this.booksByAssetId.get(market.yesTokenId);
      const noBook = this.booksByAssetId.get(market.noTokenId);
      if (yesBook && noBook) {
        scanSummary.withBooksByInterval[market.intervalMinutes] += 1;
      }
      const signal = this.signalEngine.evaluate(market, yesBook, noBook, this.latestMove);
      if (!signal) {
        continue;
      }
      scanSummary.producedByInterval[market.intervalMinutes] += 1;

      const targetBook = signal.outcome === "YES" ? yesBook : noBook;
      if (!targetBook) {
        continue;
      }

      const baseMetric = this.buildSignalMetric(signal, targetBook);
      const suppressionReason = this.getSignalSuppressionReason(signal, market, baseMetric);
      if (suppressionReason) {
        scanSummary.suppressedByInterval[market.intervalMinutes] += 1;
        scanSummary.suppressedReasons[suppressionReason] = (scanSummary.suppressedReasons[suppressionReason] ?? 0) + 1;
        this.logger.info(
          {
            component: "signalEngine",
            conditionId: signal.conditionId,
            market: baseMetric.marketLabel,
            outcome: signal.outcome,
            moveBps: baseMetric.binanceMoveBps,
            grossEdgeBps: baseMetric.grossEdgeBps,
            netEdgeBps: baseMetric.netEdgeBps,
            spreadBps: baseMetric.spreadObservedBps,
            delayMs: baseMetric.estimatedDelayMs,
            reason: suppressionReason,
          },
          "Suppressed shadow signal before persistence",
        );
        continue;
      }

      this.repository.saveSignal(signal);
      scanSummary.persistedByInterval[market.intervalMinutes] += 1;

      if (signal.status !== "approved") {
        const skipReason = this.resolveSkipReason(signal.reasons, "signal_threshold_or_score");
        this.recordSignalMetric({
          ...baseMetric,
          decision: "skipped",
          skipReason,
          updatedAt: Date.now(),
        });
        await this.notify("signal", `Senal descartada: BTC ${signal.intervalMinutes}m ${signal.outcome} | ${skipReason}`);
        continue;
      }

      await this.notify(
        "signal",
        `Senal detectada: BTC ${signal.intervalMinutes}m ${signal.outcome} edge ${signal.netEdgeBps.toFixed(1)}bps`,
      );

      const risk = this.riskManager.evaluateEntry({
        signal,
        market,
        positions,
        openOrders,
        binanceHealth: this.binanceWs.getHealth(),
        polymarketHealth: this.polymarketWs.getHealth(),
        pnlSummary,
      });

      if (!risk.allowed) {
        const skipReason = this.prefixSkipReason(risk.reason ?? "risk_rejected", "risk");
        this.recordSignalMetric({
          ...baseMetric,
          decision: "skipped",
          skipReason,
          updatedAt: Date.now(),
        });
        this.logger.info(
          {
            component: "riskManager",
            conditionId: signal.conditionId,
            market: baseMetric.marketLabel,
            signalNotional: signal.notional,
            openOrders: openOrders.length,
            openPositions: positions.length,
            totalExposureEstimate: positions.reduce((acc, position) => acc + position.entryNotional, 0) +
              openOrders.reduce((acc, order) => acc + (order.size * order.price), 0),
            skipReason,
          },
          "Blocked signal during risk evaluation",
        );
        await this.notify("signal", `Senal descartada por riesgo: ${skipReason}`);
        continue;
      }

      const intent = this.entryDecision.decide(signal, market);
      if (!intent) {
        this.recordSignalMetric({
          ...baseMetric,
          decision: "skipped",
          skipReason: this.prefixSkipReason("entry_decision_null", "execution"),
          updatedAt: Date.now(),
        });
        continue;
      }

      const result = await this.executeIntent(intent, market, targetBook);
      const entered = result.fills.length > 0 && result.order.status !== "FAILED" && result.order.status !== "REJECTED";

      this.recordSignalMetric({
        ...baseMetric,
        decision: entered ? "entered" : "skipped",
        skipReason: entered
          ? null
          : this.prefixSkipReason(result.order.rejectReason ?? result.order.status.toLowerCase(), "execution"),
        updatedAt: Date.now(),
      });
    }

    this.maybeLogSignalScanSummary(scanSummary, tick.receivedAt);
  }

  onBook(snapshot: PolymarketBookSnapshot): void {
    this.booksByAssetId.set(snapshot.assetId, snapshot);
    this.repository.saveBookSnapshot(snapshot);
  }

  async onUserTrade(payload: any): Promise<void> {
    // TODO: Validate the exact live user-stream payload fields in production credentials and tighten this parser.
    const externalOrderId = String(payload?.order_id ?? payload?.id ?? payload?.orderID ?? "");
    if (!externalOrderId) {
      return;
    }

    const order = this.orderManager.findByExternalOrderId(externalOrderId);
    if (!order) {
      return;
    }

    const market = this.marketByConditionId.get(order.conditionId);
    if (!market) {
      return;
    }

    const fill: FillRecord = {
      id: randomUUID(),
      orderId: order.id,
      positionId: order.positionId,
      conditionId: order.conditionId,
      assetId: order.assetId,
      outcome: order.outcome,
      side: order.side,
      price: Number(payload?.price ?? payload?.avg_price ?? 0),
      size: Number(payload?.size ?? payload?.matched_amount ?? payload?.filled_size ?? 0),
      fee: Number(payload?.fee ?? 0),
      mode: order.mode,
      externalTradeId: String(payload?.trade_id ?? payload?.id ?? ""),
      filledAt: Number(payload?.timestamp ?? Date.now()),
    };

    if (!fill.size || !fill.price) {
      return;
    }

    this.repository.saveFill(fill);
    const updatedOrder = {
      ...order,
      filledSize: order.filledSize + fill.size,
      status: order.filledSize + fill.size >= order.size ? "FILLED" as const : "PARTIAL" as const,
      updatedAt: Date.now(),
    };
    this.orderManager.update(updatedOrder);
    this.positionManager.applyFill(updatedOrder, fill, market);

    await this.notify("fill", updatedOrder.status === "FILLED" ? "Fill completo" : "Fill parcial");
  }

  async onUserOrder(payload: any): Promise<void> {
    const externalOrderId = String(payload?.order_id ?? payload?.id ?? payload?.orderID ?? "");
    if (!externalOrderId) {
      return;
    }

    const order = this.orderManager.findByExternalOrderId(externalOrderId);
    if (!order) {
      return;
    }

    const rawStatus = String(payload?.status ?? payload?.order_status ?? "").toUpperCase();
    const mappedStatus: OrderStatus =
      rawStatus === "FILLED" || rawStatus === "MATCHED"
        ? "FILLED"
        : rawStatus === "PARTIAL" || rawStatus === "PARTIALLY_FILLED"
          ? "PARTIAL"
          : rawStatus === "CANCELED" || rawStatus === "CANCELLED"
            ? "CANCELED"
            : rawStatus === "REJECTED"
              ? "REJECTED"
              : "OPEN";

    const updatedOrder = {
      ...order,
      status: mappedStatus,
      rejectReason: mappedStatus === "REJECTED" ? String(payload?.reason ?? payload?.message ?? "rejected") : order.rejectReason,
      updatedAt: Date.now(),
    };

    this.orderManager.update(updatedOrder);

    if (mappedStatus === "REJECTED") {
      await this.notify("order", `Orden rechazada: ${updatedOrder.rejectReason ?? "rejected"}`, "WARN");
    }
  }

  async evaluateExits(): Promise<void> {
    if (this.state !== "running") {
      return;
    }

    const positions = this.positionManager.getOpenPositions();
    for (const position of positions) {
      const market = this.marketByConditionId.get(position.conditionId);
      const book = this.booksByAssetId.get(position.assetId);
      if (!market || !book) {
        continue;
      }

      const exit = this.exitDecision.evaluate(position, book, this.latestMove);
      if (!exit?.shouldExit) {
        continue;
      }

      const intent = this.exitDecision.toExitIntent(position, book, exit.reason);
      await this.executeIntent(intent, market, book);
    }

    const pnlSummary = this.positionManager.markToMarket(this.booksByAssetId);
    this.repository.savePnlPoint({
      timestamp: Date.now(),
      realizedPnl: pnlSummary.realizedPnl,
      unrealizedPnl: pnlSummary.unrealizedPnl,
      totalPnl: pnlSummary.totalPnl,
    });

    const killReason = this.riskManager.checkForKill(pnlSummary);
    if (killReason) {
      await this.killBot(killReason);
    }
  }

  async sendHeartbeat(): Promise<void> {
    const status = this.getStatus();
    const message = `Heartbeat | state=${status.state} | openPositions=${status.pnl.openPositions} | totalPnL=${formatUsd(status.pnl.totalPnl)}`;
    await this.notify("heartbeat", message, "INFO", {}, this.config.heartbeat.telegramNotifyAll);
  }

  async reportConnection(message: string, level: "INFO" | "WARN" | "ERROR" = "WARN"): Promise<void> {
    await this.notify("connection", message, level);
  }

  formatStatus(): string {
    const status = this.getStatus();
    return [
      `state=${status.state}`,
      `shadow=${status.shadowMode}`,
      `live=${status.liveTrading}`,
      `markets=${status.discoveredMarkets}`,
      `openOrders=${status.openOrders}`,
      `openPositions=${status.pnl.openPositions}`,
      `totalPnL=${formatUsd(status.pnl.totalPnl)}`,
      `binance=${status.binance.connected ? "up" : "down"}`,
      `polyMarket=${status.polymarketMarketWs.connected ? "up" : "down"}`,
      `polyUser=${status.polymarketUserWs.connected ? "up" : "down"}`,
    ].join("\n");
  }

  formatPositions(): string {
    const positions = this.getPositions();
    if (positions.length === 0) {
      return "Sin posiciones abiertas.";
    }

    return positions
      .map(
        (position) =>
          `${position.intervalMinutes}m ${position.outcome} | size=${position.size.toFixed(4)} | entry=${position.entryPrice.toFixed(4)} | unrealized=${formatUsd(position.unrealizedPnl)}`,
      )
      .join("\n");
  }

  formatPnl(): string {
    const pnl = this.repository.getPnlSummary();
    return `realized=${formatUsd(pnl.realizedPnl)}\nunrealized=${formatUsd(pnl.unrealizedPnl)}\ntotal=${formatUsd(pnl.totalPnl)}`;
  }

  formatMarkets(): string {
    if (this.marketByConditionId.size === 0) {
      return "No hay mercados descubiertos.";
    }

    return [...this.marketByConditionId.values()]
      .map((market) => {
        const yes = this.booksByAssetId.get(market.yesTokenId);
        const no = this.booksByAssetId.get(market.noTokenId);
        return `BTC ${market.intervalMinutes}m | YES ${yes?.bestBid ?? "-"} / ${yes?.bestAsk ?? "-"} | NO ${no?.bestBid ?? "-"} / ${no?.bestAsk ?? "-"}`;
      })
      .join("\n");
  }

  formatConfig(): string {
    return JSON.stringify(this.getConfigSummary(), null, 2);
  }

  formatSummary(): string {
    const summary = this.getSignalMetricsSummary();
    const byMarket = Object.entries(summary.distributionByMarket)
      .map(([market, counts]) => `${market}:${counts.entered}/${counts.total}`)
      .join(" ");

    return [
      `signals=${summary.totalSignals}`,
      `entered=${summary.signalsExecuted}`,
      `skipped=${summary.signalsDiscarded}`,
      `enteredRate=${(summary.enteredRate * 100).toFixed(1)}%`,
      `wins=${summary.simulatedWins}`,
      `losses=${summary.simulatedLosses}`,
      `avgGross=${summary.avgGrossEdgeBps.toFixed(1)}bps`,
      `avgNet=${summary.avgNetEdgeBps.toFixed(1)}bps`,
      `avgDelay=${summary.avgEstimatedDelayMs.toFixed(0)}ms`,
      `markets=${byMarket || "n/a"}`,
    ].join("\n");
  }

  formatAnalysis(): string {
    const analysis = this.getSignalMetricsAnalysis();
    return [
      `interpretation=${analysis.interpretation}`,
      `hours=${analysis.observedHours.toFixed(1)}`,
      `signalsPerHour=${analysis.signalsPerHour.toFixed(2)}`,
      `avgNet=${analysis.avgNetEdgeBps.toFixed(1)}bps`,
      `enteredRate=${(analysis.enteredRate * 100).toFixed(1)}%`,
      `winRate=${(analysis.simulatedWinRate * 100).toFixed(1)}%`,
      `expectancySignal=${analysis.expectancyPerSignal.toFixed(4)}`,
      `expectancyTrade=${analysis.expectancyPerExecutedTrade.toFixed(4)}`,
      `bestMarket=${analysis.strongestMarket ?? "n/a"}`,
    ].join("\n");
  }

  private async executeIntent(
    intent: OrderIntent,
    market: MarketMetadata,
    book: PolymarketBookSnapshot,
  ): Promise<ExecutionResult> {
    const result = await this.orderExecutor.execute(intent, market, book);
    this.orderManager.track(result.order);

    await this.notify(
      "order",
      result.order.status === "FAILED" || result.order.status === "REJECTED"
        ? `Orden rechazada: ${result.order.rejectReason ?? "unknown"}`
        : `Orden enviada: ${intent.side} ${intent.outcome} ${intent.size.toFixed(4)} @ ${intent.price.toFixed(4)}`,
      result.order.status === "FAILED" || result.order.status === "REJECTED" ? "WARN" : "INFO",
    );

    for (const fill of result.fills) {
      this.repository.saveFill(fill);
      this.positionManager.applyFill(result.order, fill, market);
      await this.notify("fill", result.order.status === "FILLED" ? "Fill completo" : "Fill parcial");
      if (intent.side === "SELL") {
        await this.notify("exit", `Salida ejecutada: ${intent.reason}`);
      }
      await this.notify("pnl", `PnL actualizado\n${this.formatPnl()}`);
    }

    return result;
  }

  private buildSignalMetric(signal: TradeSignal, targetBook: PolymarketBookSnapshot): SignalMetricRecord {
    const { spreadObserved, spreadObservedBps } = computeSpreadObserved(
      signal.bestBid,
      signal.bestAsk,
      signal.bookPrice,
    );
    const orderBookSlippageBps =
      signal.bestAsk != null && signal.bestAsk > 0
        ? (Math.max(0, signal.bookPrice - signal.bestAsk) / signal.bestAsk) * 10_000
        : 0;
    const timing = computeSignalTiming(signal.move.endedAt, targetBook.timestamp, targetBook.receivedAt);

    return {
      signalId: signal.id,
      conditionId: signal.conditionId,
      marketLabel: `BTC ${signal.intervalMinutes}m`,
      intervalMinutes: signal.intervalMinutes,
      outcome: signal.outcome,
      binanceMoveDetectedAt: timing.binanceMoveDetectedAt,
      polymarketDetectedAt: timing.polymarketDetectedAt,
      estimatedDelayMs: timing.estimatedDelayMs,
      binanceMoveBps: signal.move.absoluteBps,
      grossEdgeBps: signal.grossEdgeBps,
      netEdgeBps: signal.netEdgeBps,
      spreadObserved,
      spreadObservedBps,
      slippageEstimatedBps: Number((orderBookSlippageBps + this.config.execution.slippageBufferBps).toFixed(2)),
      depthAvailable: signal.depthAvailable,
      decision: "skipped",
      skipReason: null,
      createdAt: signal.createdAt,
      updatedAt: signal.createdAt,
    };
  }

  private resolveSkipReason(reasons: string[], fallback: string): string {
    const filtered = reasons.filter(Boolean);
    return filtered.length > 0
      ? filtered.map((reason) => this.prefixSkipReason(reason, "signal")).join(",")
      : this.prefixSkipReason(fallback, "signal");
  }

  private recordSignalMetric(metric: SignalMetricRecord): void {
    this.repository.saveSignalMetric(metric);
    this.logger.info(
      {
        component: "shadowAnalytics",
        signalId: metric.signalId,
        market: metric.marketLabel,
        delayMs: metric.estimatedDelayMs,
        moveBps: metric.binanceMoveBps,
        grossEdgeBps: metric.grossEdgeBps,
        netEdgeBps: metric.netEdgeBps,
        spreadBps: metric.spreadObservedBps,
        slippageBps: metric.slippageEstimatedBps,
        depth: metric.depthAvailable,
        decision: metric.decision,
        skipReason: metric.skipReason,
      },
      "Shadow signal analyzed",
    );
  }

  private getSignalSuppressionReason(
    signal: TradeSignal,
    market: MarketMetadata,
    metric: SignalMetricRecord,
  ): string | null {
    this.pruneRecentSignalFingerprints(signal.createdAt);

    const fingerprint = buildSignalFingerprint({
      conditionId: signal.conditionId,
      outcome: signal.outcome,
      binanceMoveBps: metric.binanceMoveBps,
    });
    const lastSeenAt = this.recentSignalFingerprints.get(fingerprint);
    if (lastSeenAt != null && signal.createdAt - lastSeenAt < SIGNAL_DEDUP_WINDOW_MS) {
      return this.prefixSkipReason("duplicate_signal", "signal");
    }

    this.recentSignalFingerprints.set(fingerprint, signal.createdAt);

    const noiseDecision = evaluateSignalNoise(this.config, {
      intervalMinutes: market.intervalMinutes,
      priceReference: signal.bookPrice,
      spreadObservedBps: metric.spreadObservedBps,
      binanceMoveBps: metric.binanceMoveBps,
    });

    if (noiseDecision.reason) {
      return this.prefixSkipReason(noiseDecision.reason, "signal");
    }

    return null;
  }

  private pruneRecentSignalFingerprints(now: number): void {
    for (const [fingerprint, seenAt] of this.recentSignalFingerprints.entries()) {
      if (now - seenAt > SIGNAL_DEDUP_WINDOW_MS * 4) {
        this.recentSignalFingerprints.delete(fingerprint);
      }
    }
  }

  private maybeLogSignalScanSummary(summary: SignalScanSummary, now: number): void {
    if (now - this.lastSignalScanLogAt < 30_000) {
      return;
    }

    this.lastSignalScanLogAt = now;

    const market5mCoverage = `${summary.withBooksByInterval[5]}/${summary.discoveredByInterval[5]}`;
    const market15mCoverage = `${summary.withBooksByInterval[15]}/${summary.discoveredByInterval[15]}`;

    this.logger.info(
      {
        component: "signalEngine",
        moveBps: summary.moveBps,
        discoveredByInterval: summary.discoveredByInterval,
        withBooksByInterval: summary.withBooksByInterval,
        producedByInterval: summary.producedByInterval,
        persistedByInterval: summary.persistedByInterval,
        suppressedByInterval: summary.suppressedByInterval,
        suppressedReasons: summary.suppressedReasons,
        coverage5m: market5mCoverage,
        coverage15m: market15mCoverage,
      },
      "Signal engine interval coverage summary",
    );
  }

  private prefixSkipReason(
    reason: string,
    source: "signal" | "risk" | "execution",
  ): string {
    if (!reason) {
      return `${source}:unspecified`;
    }

    return reason.includes(":") ? reason : `${source}:${reason}`;
  }

  private async notify(
    category: string,
    message: string,
    level: "INFO" | "WARN" | "ERROR" = "INFO",
    context: Record<string, unknown> = {},
    toTelegram = true,
  ): Promise<void> {
    this.repository.saveEvent({
      id: randomUUID(),
      level,
      category,
      message,
      context,
      createdAt: Date.now(),
    });

    this.logger[level === "ERROR" ? "error" : level === "WARN" ? "warn" : "info"](
      { category, ...context },
      message,
    );

    if (toTelegram) {
      await this.telegram.sendMessage(message);
    }
  }
}
