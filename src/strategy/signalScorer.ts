import { AppConfig } from "../config/env";
import { BinanceMove, TradeSignal } from "../persistence/models";

export class SignalScorer {
  constructor(private readonly config: AppConfig) {}

  score(signal: Omit<TradeSignal, "score" | "status">, move: BinanceMove): number {
    const edgeScore = Math.min(Math.max(signal.netEdgeBps / Math.max(this.config.execution.edgeThresholdBps, 1), 0), 2);
    const speedScore = Math.min(move.speedBpsPerSecond / 15, 1.5);
    const liquidityScore = Math.min(signal.depthAvailable / Math.max(signal.executableSize, 1), 1.2);
    const freshnessPenalty = signal.stale ? 0.4 : 1;

    return Number((((edgeScore * 0.5) + (speedScore * 0.25) + (liquidityScore * 0.25)) * freshnessPenalty).toFixed(4));
  }
}
