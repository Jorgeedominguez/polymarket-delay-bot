export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface FillEstimate {
  averagePrice: number | null;
  filledSize: number;
  notional: number;
  exhausted: boolean;
}

export function toBps(value: number): number {
  return value * 10_000;
}

export function fromBps(value: number): number {
  return value / 10_000;
}

export function calcBpsChange(from: number, to: number): number {
  if (from === 0) {
    return 0;
  }

  return ((to - from) / from) * 10_000;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function roundDownToTick(value: number, tickSize: number): number {
  if (tickSize <= 0) {
    return value;
  }

  return Math.floor(value / tickSize) * tickSize;
}

export function roundUpToTick(value: number, tickSize: number): number {
  if (tickSize <= 0) {
    return value;
  }

  return Math.ceil(value / tickSize) * tickSize;
}

export function safeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function midpoint(bestBid: number | null, bestAsk: number | null): number | null {
  if (bestBid == null || bestAsk == null) {
    return null;
  }

  return (bestBid + bestAsk) / 2;
}

export function estimateFillFromBook(levels: OrderBookLevel[], targetSize: number): FillEstimate {
  if (targetSize <= 0 || levels.length === 0) {
    return {
      averagePrice: null,
      filledSize: 0,
      notional: 0,
      exhausted: true,
    };
  }

  let remaining = targetSize;
  let filledSize = 0;
  let notional = 0;

  for (const level of levels) {
    if (remaining <= 0) {
      break;
    }

    const fillSize = Math.min(level.size, remaining);
    if (fillSize <= 0) {
      continue;
    }

    filledSize += fillSize;
    notional += fillSize * level.price;
    remaining -= fillSize;
  }

  return {
    averagePrice: filledSize > 0 ? notional / filledSize : null,
    filledSize,
    notional,
    exhausted: remaining > 0,
  };
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
