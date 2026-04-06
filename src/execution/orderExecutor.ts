import { randomUUID } from "node:crypto";
import { Logger } from "pino";
import { PolymarketClobGateway } from "../clients/polymarketClobClient";
import { MarketMetadata, OrderIntent, OrderRecord, FillRecord, PolymarketBookSnapshot } from "../persistence/models";
import { estimateFillFromBook } from "../utils/math";

export interface ExecutionResult {
  order: OrderRecord;
  fills: FillRecord[];
}

export class OrderExecutor {
  constructor(
    private readonly clobGateway: PolymarketClobGateway,
    private readonly logger: Logger,
  ) {}

  async execute(
    intent: OrderIntent,
    market: MarketMetadata,
    book: PolymarketBookSnapshot,
  ): Promise<ExecutionResult> {
    return intent.mode === "live"
      ? this.executeLive(intent, market)
      : this.executeShadow(intent, market, book);
  }

  private async executeLive(intent: OrderIntent, market: MarketMetadata): Promise<ExecutionResult> {
    const createdAt = Date.now();
    try {
      const response = await this.clobGateway.createAndPostLimitOrder(intent);
      const order: OrderRecord = {
        id: randomUUID(),
        signalId: intent.signalId,
        positionId: intent.positionId ?? null,
        conditionId: intent.conditionId,
        assetId: intent.assetId,
        outcome: intent.outcome,
        side: intent.side,
        mode: "live",
        price: intent.price,
        size: intent.size,
        filledSize: 0,
        status: "OPEN",
        externalOrderId: String(response?.orderID ?? response?.id ?? ""),
        rejectReason: null,
        createdAt,
        updatedAt: createdAt,
      };

      this.logger.info({ component: "orderExecutor", mode: "live", externalOrderId: order.externalOrderId }, "Live order submitted");
      return { order, fills: [] };
    } catch (error) {
      const failed: OrderRecord = {
        id: randomUUID(),
        signalId: intent.signalId,
        positionId: intent.positionId ?? null,
        conditionId: intent.conditionId,
        assetId: intent.assetId,
        outcome: intent.outcome,
        side: intent.side,
        mode: "live",
        price: intent.price,
        size: intent.size,
        filledSize: 0,
        status: "FAILED",
        externalOrderId: null,
        rejectReason: error instanceof Error ? error.message : "live_order_failed",
        createdAt,
        updatedAt: createdAt,
      };

      return { order: failed, fills: [] };
    }
  }

  private executeShadow(
    intent: OrderIntent,
    market: MarketMetadata,
    book: PolymarketBookSnapshot,
  ): ExecutionResult {
    const levels = intent.side === "BUY" ? book.asks : book.bids;
    const fillEstimate = estimateFillFromBook(levels, intent.size);
    const createdAt = Date.now();
    const orderId = randomUUID();

    if (fillEstimate.averagePrice == null || fillEstimate.filledSize < intent.minOrderSize) {
      return {
        order: {
          id: orderId,
          signalId: intent.signalId,
          positionId: intent.positionId ?? null,
          conditionId: intent.conditionId,
          assetId: intent.assetId,
          outcome: intent.outcome,
          side: intent.side,
          mode: "shadow",
          price: intent.price,
          size: intent.size,
          filledSize: 0,
          status: "REJECTED",
          externalOrderId: null,
          rejectReason: "shadow_liquidity_or_min_size",
          createdAt,
          updatedAt: createdAt,
        },
        fills: [],
      };
    }

    const fee = fillEstimate.notional * (market.takerFeeBps / 10_000);
    const fill: FillRecord = {
      id: randomUUID(),
      orderId,
      positionId: intent.positionId ?? null,
      conditionId: intent.conditionId,
      assetId: intent.assetId,
      outcome: intent.outcome,
      side: intent.side,
      price: fillEstimate.averagePrice,
      size: fillEstimate.filledSize,
      fee,
      mode: "shadow",
      externalTradeId: null,
      filledAt: createdAt,
    };

    const order: OrderRecord = {
      id: orderId,
      signalId: intent.signalId,
      positionId: intent.positionId ?? null,
      conditionId: intent.conditionId,
      assetId: intent.assetId,
      outcome: intent.outcome,
      side: intent.side,
      mode: "shadow",
      price: fillEstimate.averagePrice,
      size: intent.size,
      filledSize: fillEstimate.filledSize,
      status: fillEstimate.exhausted ? "PARTIAL" : "FILLED",
      externalOrderId: null,
      rejectReason: null,
      createdAt,
      updatedAt: createdAt,
    };

    this.logger.info({ component: "orderExecutor", mode: "shadow", orderId }, "Shadow order simulated");
    return { order, fills: [fill] };
  }
}
