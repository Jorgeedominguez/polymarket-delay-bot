import { Logger } from "pino";
import { PolymarketClobGateway } from "../clients/polymarketClobClient";
import { OrderManager } from "./orderManager";

export class CancelManager {
  constructor(
    private readonly clobGateway: PolymarketClobGateway,
    private readonly orderManager: OrderManager,
    private readonly logger: Logger,
  ) {}

  async cancelAllOpenOrders(reason: string): Promise<void> {
    const openOrders = this.orderManager.getOpenOrders();
    if (openOrders.length === 0) {
      return;
    }

    if (openOrders.some((order) => order.mode === "live") && this.clobGateway.canUseL2()) {
      try {
        await this.clobGateway.cancelAllOrders();
      } catch (error) {
        this.logger.error({ component: "cancelManager", err: error }, "Failed to cancel live orders on Polymarket");
      }
    }

    this.orderManager.cancelAll(reason);
  }
}
