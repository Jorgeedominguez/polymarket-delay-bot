import { randomUUID } from "node:crypto";
import { MarketMetadata, OrderRecord, PnlSummary, PolymarketBookSnapshot, PositionRecord, FillRecord } from "../persistence/models";
import { RuntimeRepository } from "../persistence/repositories/runtimeRepository";

export class PositionManager {
  private readonly positions = new Map<string, PositionRecord>();

  constructor(private readonly repository: RuntimeRepository) {}

  hydrate(records: PositionRecord[]): void {
    for (const record of records) {
      this.positions.set(record.id, record);
    }
  }

  getOpenPositions(): PositionRecord[] {
    return [...this.positions.values()].filter((position) => position.status === "OPEN");
  }

  applyFill(order: OrderRecord, fill: FillRecord, market: MarketMetadata): PositionRecord {
    if (order.side === "BUY") {
      const position: PositionRecord = {
        id: order.positionId ?? randomUUID(),
        conditionId: order.conditionId,
        marketId: market.marketId,
        assetId: order.assetId,
        intervalMinutes: market.intervalMinutes,
        outcome: order.outcome,
        status: "OPEN",
        entryPrice: fill.price,
        currentPrice: fill.price,
        size: fill.size,
        entryNotional: fill.price * fill.size,
        realizedPnl: 0,
        unrealizedPnl: -fill.fee,
        openedAt: fill.filledAt,
        updatedAt: fill.filledAt,
        closedAt: null,
        exitReason: null,
      };

      this.positions.set(position.id, position);
      this.repository.upsertPosition(position);
      return position;
    }

    const existing = order.positionId ? this.positions.get(order.positionId) : undefined;
    if (!existing) {
      throw new Error(`Cannot close position; missing positionId for order ${order.id}`);
    }

    const realizedPnl = (fill.price - existing.entryPrice) * fill.size - fill.fee;
    const remainingSize = existing.size - fill.size;
    const closed = remainingSize <= 0.0000001;

    const updated: PositionRecord = {
      ...existing,
      size: closed ? 0 : remainingSize,
      currentPrice: fill.price,
      realizedPnl: existing.realizedPnl + realizedPnl,
      unrealizedPnl: 0,
      status: closed ? "CLOSED" : "OPEN",
      updatedAt: fill.filledAt,
      closedAt: closed ? fill.filledAt : null,
      exitReason: closed ? (order.rejectReason ?? "exit") : null,
    };

    this.positions.set(updated.id, updated);
    this.repository.upsertPosition(updated);
    return updated;
  }

  markToMarket(books: Map<string, PolymarketBookSnapshot>): PnlSummary {
    for (const position of this.getOpenPositions()) {
      const book = books.get(position.assetId);
      if (!book || book.bestBid == null) {
        continue;
      }

      const unrealizedPnl = (book.bestBid - position.entryPrice) * position.size;
      const updated: PositionRecord = {
        ...position,
        currentPrice: book.bestBid,
        unrealizedPnl,
        updatedAt: Date.now(),
      };

      this.positions.set(updated.id, updated);
      this.repository.upsertPosition(updated);
    }

    return this.repository.getPnlSummary();
  }
}
