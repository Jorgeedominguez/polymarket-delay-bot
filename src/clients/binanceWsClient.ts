import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { Logger } from "pino";
import { BinanceTick, ConnectionHealth } from "../persistence/models";

interface BinanceTradeMessage {
  e: string;
  E: number;
  s: string;
  t: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

export class BinanceWsClient extends EventEmitter {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectAttempts = 0;
  private lastMessageAt: number | null = null;
  private connected = false;

  constructor(
    private readonly baseUrl: string,
    private readonly symbol: string,
    private readonly logger: Logger,
  ) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }

  getHealth(): ConnectionHealth {
    return {
      connected: this.connected,
      lastMessageAt: this.lastMessageAt,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  private connect(): void {
    const url = `${this.baseUrl}/${this.symbol.toLowerCase()}@trade`;
    this.socket = new WebSocket(url);

    this.socket.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.logger.info({ component: "binanceWs", symbol: this.symbol }, "Connected to Binance trade stream");
      this.emit("connected");
    });

    this.socket.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      const payload = JSON.parse(raw.toString()) as BinanceTradeMessage;
      if (payload.e !== "trade") {
        return;
      }

      const tick: BinanceTick = {
        symbol: payload.s,
        tradeId: String(payload.t),
        price: Number(payload.p),
        quantity: Number(payload.q),
        eventTime: payload.E,
        tradeTime: payload.T,
        marketMaker: payload.m,
        receivedAt: Date.now(),
      };

      this.emit("tick", tick);
    });

    this.socket.on("pong", () => {
      this.lastMessageAt = Date.now();
    });

    this.socket.on("error", (error) => {
      this.logger.error({ component: "binanceWs", err: error }, "Binance websocket error");
      this.emit("error", error);
    });

    this.socket.on("close", () => {
      this.connected = false;
      this.emit("disconnected");

      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));

    this.logger.warn(
      { component: "binanceWs", reconnectAttempts: this.reconnectAttempts, delayMs },
      "Binance websocket disconnected; scheduling reconnect",
    );

    setTimeout(() => {
      if (!this.stopped) {
        this.connect();
      }
    }, delayMs);
  }
}
