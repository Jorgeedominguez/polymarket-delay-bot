import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/env";
import { createLogger } from "../utils/logger";
import { SqliteDb } from "../persistence/db";
import { RuntimeRepository } from "../persistence/repositories/runtimeRepository";
import { BinanceMoveDetector } from "../signal/binanceMoveDetector";
import { SignalEngine } from "../signal/signalEngine";
import { PolymarketLagDetector } from "../signal/polymarketLagDetector";
import { EdgeCalculator } from "../signal/edgeCalculator";
import { SignalScorer } from "../strategy/signalScorer";
import { EntryDecision } from "../strategy/entryDecision";
import { ExitDecision } from "../strategy/exitDecision";
import { ExposureManager } from "../risk/exposureManager";
import { KillSwitch } from "../risk/killSwitch";
import { RiskManager } from "../risk/riskManager";
import { OrderManager } from "../execution/orderManager";
import { PositionManager } from "../execution/positionManager";
import { OrderExecutor } from "../execution/orderExecutor";
import { CancelManager } from "../execution/cancelManager";
import { PolymarketClobGateway } from "../clients/polymarketClobClient";
import { TelegramClient } from "../clients/telegramClient";
import { BotRuntime } from "./botRuntime";
import { BtcPolymarketDiscovery } from "../discovery/btcPolymarketDiscovery";
import { BinanceWsClient } from "../clients/binanceWsClient";
import { PolymarketWsMarketClient } from "../clients/polymarketWsMarketClient";
import { PolymarketWsUserClient } from "../clients/polymarketWsUserClient";
import { DiscoveryResult } from "../discovery/btcPolymarketDiscovery";
import { ConnectionHealth, MarketMetadata, PolymarketBookSnapshot } from "../persistence/models";

class FakeDiscovery {
  constructor(private readonly result: DiscoveryResult) {}

  async discover(): Promise<DiscoveryResult> {
    return this.result;
  }
}

class FakeBinanceWs {
  start(): void {}
  stop(): void {}
  getHealth(): ConnectionHealth {
    return {
      connected: true,
      lastMessageAt: Date.now(),
      reconnectAttempts: 0,
    };
  }
}

class FakePolymarketMarketWs extends FakeBinanceWs {
  registerMarkets(_: MarketMetadata[]): void {}
  subscribeAssets(_: string[]): void {}
}

class FakePolymarketUserWs extends FakeBinanceWs {
  setMarketFilters(_: string[]): void {}
}

async function main(): Promise<void> {
  const smokeDbPath = path.resolve("./data/smoke-shadow.sqlite");
  fs.mkdirSync(path.dirname(smokeDbPath), { recursive: true });
  if (fs.existsSync(smokeDbPath)) {
    fs.rmSync(smokeDbPath, { force: true });
  }

  const config = loadConfig({
    NODE_ENV: "test",
    DB_PATH: smokeDbPath,
    SHADOW_MODE: "true",
    LIVE_TRADING: "false",
    TELEGRAM_NOTIFY_ALL: "false",
    EDGE_THRESHOLD_BPS: "5",
    SIGNAL_MIN_SCORE: "0.05",
    MAX_NOTIONAL_PER_TRADE: "10",
    BINANCE_MIN_MOVE_BPS: "5",
    STALE_BOOK_MS: "5000",
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_CHAT_ID: "",
  });

  const logger = createLogger("warn");
  const db = new SqliteDb(config.app.dbPath, logger);
  const repository = new RuntimeRepository(db);

  const metadata: MarketMetadata = {
    conditionId: "condition-btc-5m",
    marketId: "market-btc-5m",
    slug: "btc-up-or-down-5m",
    question: "Bitcoin Up or Down - 5 Minutes",
    intervalMinutes: 5,
    yesTokenId: "token-yes",
    noTokenId: "token-no",
    minimumTickSize: 0.01,
    minimumOrderSize: 1,
    takerFeeBps: 0,
    makerFeeBps: 0,
    active: true,
    closed: false,
    enableOrderBook: true,
    negRisk: false,
    lastDiscoveredAt: Date.now(),
  };

  const discovery = new FakeDiscovery({
    discovered: [
      {
        conditionId: metadata.conditionId,
        marketId: metadata.marketId,
        slug: metadata.slug,
        question: metadata.question,
        intervalMinutes: metadata.intervalMinutes,
        active: true,
        closed: false,
        discoveredAt: Date.now(),
      },
    ],
    metadata: [metadata],
  });

  const telegram = new TelegramClient("", "", logger);
  const clobGateway = new PolymarketClobGateway(config, logger);
  const orderManager = new OrderManager(repository);
  const positionManager = new PositionManager(repository);
  const runtime = new BotRuntime({
    config,
    logger,
    repository,
    discovery: discovery as unknown as BtcPolymarketDiscovery,
    telegram,
    binanceWs: new FakeBinanceWs() as unknown as BinanceWsClient,
    polymarketWs: new FakePolymarketMarketWs() as unknown as PolymarketWsMarketClient,
    polymarketUserWs: new FakePolymarketUserWs() as unknown as PolymarketWsUserClient,
    moveDetector: new BinanceMoveDetector(config),
    signalEngine: new SignalEngine(
      config,
      new PolymarketLagDetector(config),
      new EdgeCalculator(config),
      new SignalScorer(config),
    ),
    entryDecision: new EntryDecision(config),
    exitDecision: new ExitDecision(config),
    riskManager: new RiskManager(config, new ExposureManager(), new KillSwitch()),
    orderExecutor: new OrderExecutor(clobGateway, logger),
    orderManager,
    positionManager,
    cancelManager: new CancelManager(clobGateway, orderManager, logger),
  });

  await runtime.initialize();
  await runtime.startBot();

  const yesBook: PolymarketBookSnapshot = {
    conditionId: metadata.conditionId,
    assetId: metadata.yesTokenId,
    outcome: "YES",
    bestBid: 0.19,
    bestAsk: 0.2,
    midpoint: 0.195,
    bids: [{ price: 0.19, size: 200 }],
    asks: [{ price: 0.2, size: 200 }],
    minOrderSize: 1,
    tickSize: 0.01,
    timestamp: Date.now(),
    receivedAt: Date.now(),
  };

  const noBook: PolymarketBookSnapshot = {
    conditionId: metadata.conditionId,
    assetId: metadata.noTokenId,
    outcome: "NO",
    bestBid: 0.8,
    bestAsk: 0.81,
    midpoint: 0.805,
    bids: [{ price: 0.8, size: 200 }],
    asks: [{ price: 0.81, size: 200 }],
    minOrderSize: 1,
    tickSize: 0.01,
    timestamp: Date.now(),
    receivedAt: Date.now(),
  };

  runtime.onBook(yesBook);
  runtime.onBook(noBook);

  await runtime.onBinanceTick({
    symbol: "BTCUSDT",
    tradeId: "1",
    price: 100000,
    quantity: 0.1,
    eventTime: 1,
    tradeTime: 1,
    marketMaker: false,
    receivedAt: Date.now() - 2000,
  });

  await runtime.onBinanceTick({
    symbol: "BTCUSDT",
    tradeId: "2",
    price: 100800,
    quantity: 0.1,
    eventTime: 2,
    tradeTime: 2,
    marketMaker: false,
    receivedAt: Date.now(),
  });

  const status = runtime.getStatus();
  const recentSignals = runtime.getRecentSignals();
  const openPositions = runtime.getPositions();

  if (recentSignals.length === 0) {
    throw new Error("Smoke test failed: no signals were persisted");
  }

  if (openPositions.length === 0) {
    throw new Error("Smoke test failed: no shadow position was opened");
  }

  console.log(
    JSON.stringify(
      {
        smoke: "ok",
        state: status.state,
        discoveredMarkets: status.discoveredMarkets,
        recentSignals: recentSignals.length,
        openPositions: openPositions.length,
        dbPath: smokeDbPath,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
