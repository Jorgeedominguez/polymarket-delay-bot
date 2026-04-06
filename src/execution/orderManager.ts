import { OrderRecord } from "../persistence/models";
import { RuntimeRepository } from "../persistence/repositories/runtimeRepository";

export class OrderManager {
  private readonly openOrders = new Map<string, OrderRecord>();

  constructor(private readonly repository: RuntimeRepository) {}

  hydrate(records: OrderRecord[]): void {
    for (const record of records) {
      this.openOrders.set(record.id, record);
    }
  }

  track(order: OrderRecord): void {
    if (["NEW", "OPEN", "PARTIAL"].includes(order.status)) {
      this.openOrders.set(order.id, order);
    } else {
      this.openOrders.delete(order.id);
    }

    this.repository.upsertOrder(order);
  }

  update(order: OrderRecord): void {
    this.track(order);
  }

  getOpenOrders(): OrderRecord[] {
    return [...this.openOrders.values()];
  }

  findByExternalOrderId(externalOrderId: string): OrderRecord | undefined {
    return this.getOpenOrders().find((order) => order.externalOrderId === externalOrderId);
  }

  cancelAll(reason: string): void {
    for (const order of this.getOpenOrders()) {
      this.track({
        ...order,
        status: "CANCELED",
        rejectReason: reason,
        updatedAt: Date.now(),
      });
    }
  }
}
