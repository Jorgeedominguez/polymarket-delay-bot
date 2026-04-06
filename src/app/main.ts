import "dotenv/config";
import { loadConfig } from "../config/env";
import { createLogger } from "../utils/logger";
import { SqliteDb } from "../persistence/db";
import { RuntimeRepository } from "../persistence/repositories/runtimeRepository";
import { PolymarketDiscoveryClient } from "../clients/polymarketDiscoveryClient";
import { PolymarketClobGateway } from "../clients/polymarketClobClient";
import { TelegramClient } from "../clients/telegramClient";
import { BinanceWsClient } from "../clients/binanceWsClient";
import { PolymarketWsMarketClient } from "../clients/polymarketWsMarketClient";
import { PolymarketWsUserClient } from "../clients/polymarketWsUserClient";
import { BtcPolymarketDiscovery } from "../discovery/btcPolymarketDiscovery";
import { BinanceMoveDetector } from "../signal/binanceMoveDetector";
import { PolymarketLagDetector } from "../signal/polymarketLagDetector";
import { EdgeCalculator } from "../signal/edgeCalculator";
import { SignalScorer } from "../strategy/signalScorer";
import { SignalEngine } from "../signal/signalEngine";
import { EntryDecision } from "../strategy/entryDecision";
import { ExitDecision } from "../strategy/exitDecision";
import { ExposureManager } from "../risk/exposureManager";
import { KillSwitch } from "../risk/killSwitch";
import { RiskManager } from "../risk/riskManager";
import { OrderExecutor } from "../execution/orderExecutor";
import { OrderManager } from "../execution/orderManager";
import { PositionManager } from "../execution/positionManager";
import { CancelManager } from "../execution/cancelManager";
import { BotRuntime } from "./botRuntime";
import { CommandHandler } from "./commandHandler";
import { Scheduler } from "./scheduler";
import { HealthServer } from "./healthServer";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.app.logLevel);
  const db = new SqliteDb(config.app.dbPath, logger);
  const repository = new RuntimeRepository(db);

  const clobGateway = new PolymarketClobGateway(config, logger);
  const discoveryClient = new PolymarketDiscoveryClient(config.polymarket.gammaUrl, logger);
  const discovery = new BtcPolymarketDiscovery(discoveryClient, clobGateway, logger);
  const telegram = new TelegramClient(config.telegram.botToken, config.telegram.chatId, logger);
  const binanceWs = new BinanceWsClient(config.binance.wsUrl, config.execution.symbol, logger);
  const polymarketWs = new PolymarketWsMarketClient(logger);
  const polymarketUserWs = new PolymarketWsUserClient(
    config.polymarket.apiKey && config.polymarket.apiSecret && config.polymarket.apiPassphrase
      ? {
          apiKey: config.polymarket.apiKey,
          secret: config.polymarket.apiSecret,
          passphrase: config.polymarket.apiPassphrase,
        }
      : null,
    logger,
  );

  const moveDetector = new BinanceMoveDetector(config);
  const signalEngine = new SignalEngine(
    config,
    new PolymarketLagDetector(config),
    new EdgeCalculator(config),
    new SignalScorer(config),
  );
  const entryDecision = new EntryDecision(config);
  const exitDecision = new ExitDecision(config);
  const riskManager = new RiskManager(config, new ExposureManager(), new KillSwitch());
  const orderManager = new OrderManager(repository);
  const positionManager = new PositionManager(repository);
  const orderExecutor = new OrderExecutor(clobGateway, logger);
  const cancelManager = new CancelManager(clobGateway, orderManager, logger);

  const runtime = new BotRuntime({
    config,
    logger,
    repository,
    discovery,
    telegram,
    binanceWs,
    polymarketWs,
    polymarketUserWs,
    moveDetector,
    signalEngine,
    entryDecision,
    exitDecision,
    riskManager,
    orderExecutor,
    orderManager,
    positionManager,
    cancelManager,
  });

  binanceWs.on("tick", (tick) => {
    void runtime.onBinanceTick(tick);
  });

  binanceWs.on("connected", () => {
    void runtime.reportConnection("Reconexión Binance WS exitosa", "INFO");
  });

  binanceWs.on("disconnected", () => {
    void runtime.reportConnection("Error de conexión: Binance WS desconectado", "WARN");
  });

  polymarketWs.on("book", (book) => {
    runtime.onBook(book);
  });

  polymarketWs.on("connected", () => {
    void runtime.reportConnection("Reconexión Polymarket market WS exitosa", "INFO");
  });

  polymarketWs.on("disconnected", () => {
    void runtime.reportConnection("Error de conexión: Polymarket market WS desconectado", "WARN");
  });

  polymarketUserWs.on("trade", (payload) => {
    void runtime.onUserTrade(payload);
  });

  polymarketUserWs.on("order", (payload) => {
    void runtime.onUserOrder(payload);
  });

  polymarketUserWs.on("connected", () => {
    void runtime.reportConnection("Reconexión Polymarket user WS exitosa", "INFO");
  });

  polymarketUserWs.on("disconnected", () => {
    void runtime.reportConnection("Error de conexión: Polymarket user WS desconectado", "WARN");
  });

  const commandHandler = new CommandHandler(telegram, runtime);
  commandHandler.register();

  await telegram.start();
  await runtime.initialize();
  runtime.startInfrastructure();

  const scheduler = new Scheduler(config, runtime, logger);
  scheduler.start();

  const healthServer = new HealthServer(config, runtime);
  await healthServer.start();

  const shutdown = async (reason: string) => {
    scheduler.stop();
    binanceWs.stop();
    polymarketWs.stop();
    polymarketUserWs.stop();
    await telegram.stop();
    await healthServer.stop();
    logger.info({ component: "main", reason }, "Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
