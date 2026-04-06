import { OrderRecord, PositionRecord } from "../persistence/models";

export class ExposureManager {
  totalExposure(positions: PositionRecord[], openOrders: OrderRecord[]): number {
    const positionExposure = positions.reduce((acc, position) => acc + position.entryNotional, 0);
    const orderExposure = openOrders.reduce((acc, order) => acc + (order.size * order.price), 0);
    return positionExposure + orderExposure;
  }

  countPositionsForMarket(conditionId: string, positions: PositionRecord[]): number {
    return positions.filter((position) => position.conditionId === conditionId && position.status === "OPEN").length;
  }
}
