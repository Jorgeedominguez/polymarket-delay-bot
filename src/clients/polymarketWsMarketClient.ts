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

interface MarketSubscriptionPayload {
  assets_ids: string[];
  custom_feature_enabled: true;
  type?: "market";
  operation?: "subscribe";
}

export class PolymarketWsMarketClient extends EventEmitter {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectAttempts = 0;
  private lastMessageAt: number | null = null;
  private connected = false;
  private readonly assetIds = new Set<string>();
  private readonly subscribedAssetIds = new Set<string>();
  private readonly metadataByAsset = new Map<string, { conditionId: string; outcome: Outcome; minOrderSize: number; tickSize: number }>();
  private readonly books = new Map<string, BookState>();
  private initialSubscriptionSent = false;
  private lastSubscriptionPayload: MarketSubscriptionPayload | null = null;

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
    const beforeSize = this.assetIds.size;
    const sanitized = this.sanitizeAssetIds(assetIds);
    for (const assetId of sanitized.validAssetIds) {
      this.assetIds.add(assetId);
    }

    const newAssetIds = sanitized.validAssetIds.filter((assetId) => !this.subscribedAssetIds.has(assetId));

    this.logger.info(
      {
        component: "polyMarketWs",
        requestedAssetCount: assetIds.length,
        validAssetCount: sanitized.validAssetIds.length,
        invalidAssetCount: sanitized.invalidAssetCount,
        duplicateAssetCount: sanitized.duplicateAssetCount,
        totalTrackedAssets: this.assetIds.size,
        newAssetCount: newAssetIds.length,
      },
      "Validated market websocket asset IDs",
    );

    if (this.assetIds.size === beforeSize && newAssetIds.length === 0) {
      return;
    }

    this.sendSubscription(newAssetIds);
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
      this.initialSubscriptionSent = false;
      this.subscribedAssetIds.clear();
      this.logger.info({ component: "polyMarketWs" }, "Connected to Polymarket market websocket");
      this.sendSubscription();
      this.emit("connected");
    });

    this.socket.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      this.handleRawMessage(raw);
    });

    this.socket.on("error", (error) => {
      this.logger.error({ component: "polyMarketWs", err: error }, "Polymarket market websocket error");
      this.emit("error", error);
    });

    this.socket.on("close", () => {
      this.connected = false;
      this.initialSubscriptionSent = false;
      this.subscribedAssetIds.clear();
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

  private handleRawMessage(raw: unknown): void {
    const rawPayload = this.toRawText(raw).trim();
    if (!rawPayload) {
      this.logger.warn({ component: "polyMarketWs", rawPayload }, "Received empty payload from Polymarket market websocket");
      return;
    }

    if (rawPayload === "PONG") {
      this.logger.info({ component: "polyMarketWs" }, "Received PONG from Polymarket market websocket");
      return;
    }

    let payload: MarketSocketMessage | MarketSocketMessage[];
    try {
      payload = JSON.parse(rawPayload) as MarketSocketMessage | MarketSocketMessage[];
    } catch {
      this.logger.warn(
        {
          component: "polyMarketWs",
          rawPayload,
          lastSubscriptionPayload: this.lastSubscriptionPayload,
        },
        "Received non-JSON payload from Polymarket market websocket",
      );

      if (rawPayload.toUpperCase() === "INVALID OPERATION") {
        this.handleInvalidOperation(rawPayload);
      }

      return;
    }

    const messages = Array.isArray(payload) ? payload : [payload];
    for (const message of messages) {
      this.handleMessage(message);
    }
  }

  private handleInvalidOperation(rawPayload: string): void {
    this.logger.error(
      {
        component: "polyMarketWs",
        rawPayload,
        trackedAssetCount: this.assetIds.size,
        subscribedAssetCount: this.subscribedAssetIds.size,
        lastSubscriptionPayload: this.lastSubscriptionPayload,
      },
      "Polymarket market websocket rejected the subscription with INVALID OPERATION",
    );

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.logger.warn(
        { component: "polyMarketWs" },
        "Closing market websocket after INVALID OPERATION so the normal reconnect flow can retry safely",
      );
      this.socket.close();
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

  private sendSubscription(requestedAssetIds?: string[]): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const assetIds = requestedAssetIds && requestedAssetIds.length > 0 ? requestedAssetIds : [...this.assetIds];
    const sanitized = this.sanitizeAssetIds(assetIds);
    if (sanitized.validAssetIds.length === 0) {
      this.logger.warn(
        {
          component: "polyMarketWs",
          requestedAssetCount: assetIds.length,
          invalidAssetCount: sanitized.invalidAssetCount,
        },
        "Skipped market websocket subscription because there were no valid asset IDs",
      );
      return;
    }

    const payload = this.initialSubscriptionSent
      ? this.buildIncrementalSubscriptionPayload(
          sanitized.validAssetIds.filter((assetId) => !this.subscribedAssetIds.has(assetId)),
        )
      : this.buildInitialSubscriptionPayload(sanitized.validAssetIds);

    if (!payload || payload.assets_ids.length === 0) {
      return;
    }

    this.lastSubscriptionPayload = payload;
    this.logger.info(
      {
        component: "polyMarketWs",
        subscriptionPayload: payload,
        trackedAssetCount: this.assetIds.size,
        subscribedAssetCount: this.subscribedAssetIds.size,
      },
      "Sending Polymarket market subscription payload",
    );

    this.socket.send(JSON.stringify(payload));
    payload.assets_ids.forEach((assetId) => this.subscribedAssetIds.add(assetId));
    this.initialSubscriptionSent = true;
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

  private sanitizeAssetIds(assetIds: string[]): {
    validAssetIds: string[];
    invalidAssetCount: number;
    duplicateAssetCount: number;
  } {
    const seen = new Set<string>();
    const validAssetIds: string[] = [];
    let invalidAssetCount = 0;
    let duplicateAssetCount = 0;

    for (const assetId of assetIds) {
      const normalized = String(assetId ?? "").trim();
      if (!normalized) {
        invalidAssetCount += 1;
        continue;
      }

      if (seen.has(normalized)) {
        duplicateAssetCount += 1;
        continue;
      }

      seen.add(normalized);
      validAssetIds.push(normalized);
    }

    return {
      validAssetIds,
      invalidAssetCount,
      duplicateAssetCount,
    };
  }

  private buildInitialSubscriptionPayload(assetIds: string[]): MarketSubscriptionPayload | null {
    if (assetIds.length === 0) {
      return null;
    }

    return {
      assets_ids: assetIds,
      type: "market",
      custom_feature_enabled: true,
    };
  }

  private buildIncrementalSubscriptionPayload(assetIds: string[]): MarketSubscriptionPayload | null {
    if (assetIds.length === 0) {
      return null;
    }

    return {
      assets_ids: assetIds,
      operation: "subscribe",
      custom_feature_enabled: true,
    };
  }

  private toRawText(raw: unknown): string {
    if (typeof raw === "string") {
      return raw;
    }

    if (Buffer.isBuffer(raw)) {
      return raw.toString("utf8");
    }

    if (Array.isArray(raw) && raw.every((item) => Buffer.isBuffer(item))) {
      return Buffer.concat(raw).toString("utf8");
    }

    return String(raw ?? "");
  }
}
