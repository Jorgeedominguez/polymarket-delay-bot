import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { Logger } from "pino";
import { ConnectionHealth, MarketMetadata, Outcome, PolymarketBookSnapshot } from "../persistence/models";
import { midpoint, OrderBookLevel, safeNumber } from "../utils/math";

interface PriceChange {
  asset_id: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  best_bid?: string;
  best_ask?: string;
}

interface MarketSocketMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  timestamp?: string;
  hash?: string;
  best_bid?: string;
  best_ask?: string;
  min_order_size?: string;
  tick_size?: string;
  price_changes?: PriceChange[];
}

interface BookState {
  snapshot: PolymarketBookSnapshot;
}

export class PolymarketWsMarketClient extends EventEmitter {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectAttempts = 0;
  private lastMessageAt: number | null = null;
  private connected = false;
  private readonly assetIds = new Set<string>();
  private readonly metadataByAsset = new Map<string, { conditionId: string; outcome: Outcome; minOrderSize: number; tickSize: number }>();
  private readonly books = new Map<string, BookState>();

  constructor(private readonly logger: Logger) {
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

  registerMarkets(markets: MarketMetadata[]): void {
    for (const market of markets) {
      this.metadataByAsset.set(market.yesTokenId, {
        conditionId: market.conditionId,
        outcome: "YES",
        minOrderSize: market.minimumOrderSize,
        tickSize: market.minimumTickSize,
      });

      this.metadataByAsset.set(market.noTokenId, {
        conditionId: market.conditionId,
        outcome: "NO",
        minOrderSize: market.minimumOrderSize,
        tickSize: market.minimumTickSize,
      });
    }
  }

  subscribeAssets(assetIds: string[]): void {
    for (const assetId of assetIds) {
      this.assetIds.add(assetId);
    }

    this.sendSubscription();
  }

  getBook(assetId: string): PolymarketBookSnapshot | undefined {
    return this.books.get(assetId)?.snapshot;
  }

  getHealth(): ConnectionHealth {
    return {
      connected: this.connected,
      lastMessageAt: this.lastMessageAt,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  private connect(): void {
    this.socket = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");

    this.socket.on("open", () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.logger.info({ component: "polyMarketWs" }, "Connected to Polymarket market websocket");
      this.sendSubscription();
      this.emit("connected");
    });

    this.socket.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      const payload = JSON.parse(raw.toString()) as MarketSocketMessage | MarketSocketMessage[];
      const messages = Array.isArray(payload) ? payload : [payload];
      for (const message of messages) {
        this.handleMessage(message);
      }
    });

    this.socket.on("error", (error) => {
      this.logger.error({ component: "polyMarketWs", err: error }, "Polymarket market websocket error");
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

  private handleMessage(message: MarketSocketMessage): void {
    if (message.event_type === "price_change" && message.price_changes) {
      for (const change of message.price_changes) {
        this.applyPriceChange(change, message.timestamp);
      }
      return;
    }

    if (message.asset_id && (message.bids || message.asks || message.best_bid || message.best_ask)) {
      this.upsertBook(message.asset_id, {
        bids: this.mapLevels(message.bids),
        asks: this.mapLevels(message.asks),
        timestamp: safeNumber(message.timestamp, Date.now()),
        hash: message.hash,
        bestBid: message.best_bid ? safeNumber(message.best_bid, 0) : undefined,
        bestAsk: message.best_ask ? safeNumber(message.best_ask, 0) : undefined,
        tickSize: message.tick_size ? safeNumber(message.tick_size, 0) : undefined,
        minOrderSize: message.min_order_size ? safeNumber(message.min_order_size, 0) : undefined,
      });
    }
  }

  private applyPriceChange(change: PriceChange, timestamp?: string): void {
    const existing = this.books.get(change.asset_id)?.snapshot;
    if (!existing) {
      return;
    }

    const side = change.side === "BUY" ? "bids" : "asks";
    const levels = [...existing[side]];
    const targetPrice = safeNumber(change.price, 0);
    const targetSize = safeNumber(change.size, 0);
    const existingIndex = levels.findIndex((level) => level.price === targetPrice);

    if (targetSize === 0) {
      if (existingIndex >= 0) {
        levels.splice(existingIndex, 1);
      }
    } else if (existingIndex >= 0) {
      levels[existingIndex] = { price: targetPrice, size: targetSize };
    } else {
      levels.push({ price: targetPrice, size: targetSize });
    }

    this.upsertBook(change.asset_id, {
      bids: side === "bids" ? levels : undefined,
      asks: side === "asks" ? levels : undefined,
      timestamp: safeNumber(timestamp, Date.now()),
      bestBid: change.best_bid ? safeNumber(change.best_bid, 0) : undefined,
      bestAsk: change.best_ask ? safeNumber(change.best_ask, 0) : undefined,
    });
  }

  private upsertBook(
    assetId: string,
    partial: {
      bids?: OrderBookLevel[];
      asks?: OrderBookLevel[];
      timestamp: number;
      hash?: string;
      bestBid?: number;
      bestAsk?: number;
      tickSize?: number;
      minOrderSize?: number;
    },
  ): void {
    const metadata = this.metadataByAsset.get(assetId);
    if (!metadata) {
      return;
    }

    const previous = this.books.get(assetId)?.snapshot;
    const bids = (partial.bids ?? previous?.bids ?? []).sort((a, b) => b.price - a.price);
    const asks = (partial.asks ?? previous?.asks ?? []).sort((a, b) => a.price - b.price);

    const snapshot: PolymarketBookSnapshot = {
      conditionId: metadata.conditionId,
      assetId,
      outcome: metadata.outcome,
      bids,
      asks,
      bestBid: partial.bestBid ?? bids[0]?.price ?? previous?.bestBid ?? null,
      bestAsk: partial.bestAsk ?? asks[0]?.price ?? previous?.bestAsk ?? null,
      midpoint: midpoint(
        partial.bestBid ?? bids[0]?.price ?? previous?.bestBid ?? null,
        partial.bestAsk ?? asks[0]?.price ?? previous?.bestAsk ?? null,
      ),
      minOrderSize: partial.minOrderSize ?? previous?.minOrderSize ?? metadata.minOrderSize,
      tickSize: partial.tickSize ?? previous?.tickSize ?? metadata.tickSize,
      timestamp: partial.timestamp,
      hash: partial.hash ?? previous?.hash,
      receivedAt: Date.now(),
    };

    this.books.set(assetId, { snapshot });
    this.emit("book", snapshot);
  }

  private mapLevels(levels?: Array<{ price: string; size: string }>): OrderBookLevel[] | undefined {
    if (!levels) {
      return undefined;
    }

    return levels.map((level) => ({
      price: safeNumber(level.price, 0),
      size: safeNumber(level.size, 0),
    }));
  }

  private sendSubscription(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.assetIds.size === 0) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: "market",
        assets_ids: [...this.assetIds],
        custom_feature_enabled: true,
      }),
    );
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));

    this.logger.warn(
      { component: "polyMarketWs", reconnectAttempts: this.reconnectAttempts, delayMs },
      "Polymarket market websocket disconnected; scheduling reconnect",
    );

    setTimeout(() => {
      if (!this.stopped) {
        this.connect();
      }
    }, delayMs);
  }
}
