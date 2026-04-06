import { z } from "zod";

const booleanString = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value == null || value === "") {
      return defaultValue;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }

    return defaultValue;
  }, z.boolean());

const numberString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value == null || value === "") {
        return defaultValue;
      }

      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid number value: ${value}`);
      }

      return parsed;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DATA_DIR: z.string().default("./data"),
  DB_PATH: z.string().default("./data/bot.sqlite"),
  SYMBOL: z.string().default("BTCUSDT"),
  SHADOW_MODE: booleanString(true),
  LIVE_TRADING: booleanString(false),
  TELEGRAM_NOTIFY_ALL: booleanString(true),
  BINANCE_WS_URL: z.string().default("wss://stream.binance.com:9443/ws"),
  BINANCE_MOVE_WINDOW_MS: numberString(3000),
  BINANCE_MIN_MOVE_BPS: numberString(8),
  BINANCE_MAX_TICK_BUFFER: numberString(300),
  POLYMARKET_HOST: z.string().default("https://clob.polymarket.com"),
  POLYMARKET_GAMMA_URL: z.string().default("https://gamma-api.polymarket.com"),
  POLYMARKET_CHAIN_ID: numberString(137),
  POLYMARKET_SIGNATURE_TYPE: numberString(2),
  POLYMARKET_FUNDER_ADDRESS: z.string().optional().default(""),
  POLYMARKET_PRIVATE_KEY: z.string().optional().default(""),
  POLYMARKET_API_KEY: z.string().optional().default(""),
  POLYMARKET_API_SECRET: z.string().optional().default(""),
  POLYMARKET_API_PASSPHRASE: z.string().optional().default(""),
  EDGE_THRESHOLD_BPS: numberString(18),
  SLIPPAGE_BUFFER_BPS: numberString(6),
  STALE_BOOK_MS: numberString(1500),
  MAX_NOTIONAL_PER_TRADE: numberString(25),
  MAX_TOTAL_EXPOSURE: numberString(100),
  MAX_DRAWDOWN_DAILY: numberString(100),
  MAX_SIMULTANEOUS_ORDERS: numberString(3),
  MAX_OPEN_POSITIONS_PER_MARKET: numberString(1),
  ENTRY_TIMEOUT_MS: numberString(3000),
  EXIT_TIMEOUT_MS: numberString(120000),
  TAKE_PROFIT_BPS: numberString(30),
  STOP_LOSS_BPS: numberString(16),
  SIGNAL_MIN_SCORE: numberString(0.55),
  POLY_5M_SENSITIVITY: numberString(1.35),
  POLY_15M_SENSITIVITY: numberString(0.9),
  DISCOVERY_REFRESH_MS: numberString(60000),
  HEARTBEAT_INTERVAL_MS: numberString(60000),
  EXIT_CHECK_INTERVAL_MS: numberString(2000),
  HTTP_HOST: z.string().default("0.0.0.0"),
  HTTP_PORT: numberString(3000),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  app: {
    nodeEnv: RawEnv["NODE_ENV"];
    logLevel: string;
    dataDir: string;
    dbPath: string;
  };
  execution: {
    symbol: string;
    shadowMode: boolean;
    liveTrading: boolean;
    edgeThresholdBps: number;
    slippageBufferBps: number;
    maxNotionalPerTrade: number;
    entryTimeoutMs: number;
    exitTimeoutMs: number;
    takeProfitBps: number;
    stopLossBps: number;
    signalMinScore: number;
  };
  risk: {
    staleBookMs: number;
    maxTotalExposure: number;
    maxDrawdownDaily: number;
    maxSimultaneousOrders: number;
    maxOpenPositionsPerMarket: number;
  };
  signal: {
    binanceMoveWindowMs: number;
    binanceMinMoveBps: number;
    binanceMaxTickBuffer: number;
    poly5mSensitivity: number;
    poly15mSensitivity: number;
  };
  discovery: {
    refreshMs: number;
  };
  heartbeat: {
    intervalMs: number;
    telegramNotifyAll: boolean;
  };
  exits: {
    checkIntervalMs: number;
  };
  http: {
    host: string;
    port: number;
  };
  binance: {
    wsUrl: string;
  };
  polymarket: {
    host: string;
    gammaUrl: string;
    chainId: number;
    signatureType: number;
    funderAddress: string;
    privateKey: string;
    apiKey: string;
    apiSecret: string;
    apiPassphrase: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    app: {
      nodeEnv: parsed.NODE_ENV,
      logLevel: parsed.LOG_LEVEL,
      dataDir: parsed.DATA_DIR,
      dbPath: parsed.DB_PATH,
    },
    execution: {
      symbol: parsed.SYMBOL,
      shadowMode: parsed.SHADOW_MODE,
      liveTrading: parsed.LIVE_TRADING,
      edgeThresholdBps: parsed.EDGE_THRESHOLD_BPS,
      slippageBufferBps: parsed.SLIPPAGE_BUFFER_BPS,
      maxNotionalPerTrade: parsed.MAX_NOTIONAL_PER_TRADE,
      entryTimeoutMs: parsed.ENTRY_TIMEOUT_MS,
      exitTimeoutMs: parsed.EXIT_TIMEOUT_MS,
      takeProfitBps: parsed.TAKE_PROFIT_BPS,
      stopLossBps: parsed.STOP_LOSS_BPS,
      signalMinScore: parsed.SIGNAL_MIN_SCORE,
    },
    risk: {
      staleBookMs: parsed.STALE_BOOK_MS,
      maxTotalExposure: parsed.MAX_TOTAL_EXPOSURE,
      maxDrawdownDaily: parsed.MAX_DRAWDOWN_DAILY,
      maxSimultaneousOrders: parsed.MAX_SIMULTANEOUS_ORDERS,
      maxOpenPositionsPerMarket: parsed.MAX_OPEN_POSITIONS_PER_MARKET,
    },
    signal: {
      binanceMoveWindowMs: parsed.BINANCE_MOVE_WINDOW_MS,
      binanceMinMoveBps: parsed.BINANCE_MIN_MOVE_BPS,
      binanceMaxTickBuffer: parsed.BINANCE_MAX_TICK_BUFFER,
      poly5mSensitivity: parsed.POLY_5M_SENSITIVITY,
      poly15mSensitivity: parsed.POLY_15M_SENSITIVITY,
    },
    discovery: {
      refreshMs: parsed.DISCOVERY_REFRESH_MS,
    },
    heartbeat: {
      intervalMs: parsed.HEARTBEAT_INTERVAL_MS,
      telegramNotifyAll: parsed.TELEGRAM_NOTIFY_ALL,
    },
    exits: {
      checkIntervalMs: parsed.EXIT_CHECK_INTERVAL_MS,
    },
    http: {
      host: parsed.HTTP_HOST,
      port: parsed.HTTP_PORT,
    },
    binance: {
      wsUrl: parsed.BINANCE_WS_URL,
    },
    polymarket: {
      host: parsed.POLYMARKET_HOST,
      gammaUrl: parsed.POLYMARKET_GAMMA_URL,
      chainId: parsed.POLYMARKET_CHAIN_ID,
      signatureType: parsed.POLYMARKET_SIGNATURE_TYPE,
      funderAddress: parsed.POLYMARKET_FUNDER_ADDRESS,
      privateKey: parsed.POLYMARKET_PRIVATE_KEY,
      apiKey: parsed.POLYMARKET_API_KEY,
      apiSecret: parsed.POLYMARKET_API_SECRET,
      apiPassphrase: parsed.POLYMARKET_API_PASSPHRASE,
    },
    telegram: {
      botToken: parsed.TELEGRAM_BOT_TOKEN,
      chatId: parsed.TELEGRAM_CHAT_ID,
    },
  };
}
