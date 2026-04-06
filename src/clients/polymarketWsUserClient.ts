import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { Logger } from "pino";
import { ConnectionHealth } from "../persistence/models";

export interface UserWsCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export class PolymarketWsUserClient extends EventEmitter {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectAttempts = 0;
  private lastMessageAt: number | null = null;
  private connected = false;
  private marketFilters = new Set<string>();

  constructor(
    private readonly credentials: UserWsCredentials | null,
    private readonly logger: Logger,
  ) {
    super();
  }

  setMarketFilters(conditionIds: string[]): void {
    this.marketFilters = new Set(conditionIds);
    this.sendSubscription();
  }

  start(): void {
    if (!this.credentials) {
      this.logger.warn({ component: "polyUserWs" }, "Polymarket user websocket disabled due to missing API credentials");
      return;
    }

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
    this.socket = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/user");

    this.socket.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.logger.info({ component: "polyUserWs" }, "Connected to Polymarket user websocket");
      this.sendSubscription();
      this.emit("connected");
    });

    this.socket.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      const payload = JSON.parse(raw.toString());
      this.emit("userEvent", payload);

      if (payload?.event_type === "trade" || payload?.event_type === "order" || payload?.event_type === "status") {
        this.emit(payload.event_type, payload);
      }
    });

    this.socket.on("error", (error) => {
      this.logger.error({ component: "polyUserWs", err: error }, "Polymarket user websocket error");
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

  private sendSubscription(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.credentials) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "user",
        auth: this.credentials,
        markets: [...this.marketFilters],
      }),
    );
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));

    this.logger.warn(
      { component: "polyUserWs", reconnectAttempts: this.reconnectAttempts, delayMs },
      "Polymarket user websocket disconnected; scheduling reconnect",
    );

    setTimeout(() => {
      if (!this.stopped) {
        this.connect();
      }
    }, delayMs);
  }
}
