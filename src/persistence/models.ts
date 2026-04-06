import { OrderBookLevel } from "../utils/math";

export type BotLifecycleState = "stopped" | "running" | "paused" | "killed";
export type TradeDirection = "UP" | "DOWN" | "FLAT";
export type Outcome = "YES" | "NO";
export type TradeSide = "BUY" | "SELL";
export type SignalStatus = "detected" | "discarded" | "approved" | "executed";
export type OrderStatus = "NEW" | "OPEN" | "PARTIAL" | "FILLED" | "CANCELED" | "REJECTED" | "FAILED";
export type PositionStatus = "OPEN" | "CLOSED";
export type ExecutionMode = "shadow" | "live";
export type SignalDecision = "entered" | "skipped";

export interface DiscoveredMarket {
  conditionId: string;
  marketId: string;
  slug: string;
  question: string;
  intervalMinutes: 5 | 15;
  active: boolean;
  closed: boolean;
  discoveredAt: number;
}

export interface MarketMetadata {
  conditionId: string;
  marketId: string;
  slug: string;
  question: string;
  intervalMinutes: 5 | 15;
  yesTokenId: string;
  noTokenId: string;
  minimumTickSize: number;
  minimumOrderSize: number;
  takerFeeBps: number;
  makerFeeBps: number;
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  negRisk: boolean;
  lastDiscoveredAt: number;
}

export interface BinanceTick {
  symbol: string;
  tradeId: string;
  price: number;
  quantity: number;
  eventTime: number;
  tradeTime: number;
  marketMaker: boolean;
  receivedAt: number;
}

export interface PolymarketBookSnapshot {
  conditionId: string;
  assetId: string;
  outcome: Outcome;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  minOrderSize: number;
  tickSize: number;
  timestamp: number;
  hash?: string;
  receivedAt: number;
}

export interface BinanceMove {
  direction: TradeDirection;
  absoluteBps: number;
  signedBps: number;
  speedBpsPerSecond: number;
  windowMs: number;
  startPrice: number;
  endPrice: number;
  startedAt: number;
  endedAt: number;
}

export interface TradeSignal {
  id: string;
  createdAt: number;
  conditionId: string;
  intervalMinutes: 5 | 15;
  outcome: Outcome;
  side: "BUY";
  referencePrice: number;
  targetPrice: number;
  bookPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  expectedProbability: number;
  executableSize: number;
  depthAvailable: number;
  notional: number;
  grossEdgeBps: number;
  netEdgeBps: number;
  score: number;
  stale: boolean;
  status: SignalStatus;
  reasons: string[];
  move: BinanceMove;
}

export interface OrderIntent {
  signalId: string;
  conditionId: string;
  marketId: string;
  assetId: string;
  positionId?: string;
  intervalMinutes: 5 | 15;
  outcome: Outcome;
  side: TradeSide;
  price: number;
  size: number;
  notional: number;
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  mode: ExecutionMode;
  timeoutMs: number;
  reason: string;
}

export interface OrderRecord {
  id: string;
  signalId: string | null;
  positionId: string | null;
  conditionId: string;
  assetId: string;
  outcome: Outcome;
  side: TradeSide;
  mode: ExecutionMode;
  price: number;
  size: number;
  filledSize: number;
  status: OrderStatus;
  externalOrderId: string | null;
  rejectReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FillRecord {
  id: string;
  orderId: string;
  positionId: string | null;
  conditionId: string;
  assetId: string;
  outcome: Outcome;
  side: TradeSide;
  price: number;
  size: number;
  fee: number;
  mode: ExecutionMode;
  externalTradeId: string | null;
  filledAt: number;
}

export interface PositionRecord {
  id: string;
  conditionId: string;
  marketId: string;
  assetId: string;
  intervalMinutes: 5 | 15;
  outcome: Outcome;
  status: PositionStatus;
  entryPrice: number;
  currentPrice: number | null;
  size: number;
  entryNotional: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openedAt: number;
  updatedAt: number;
  closedAt: number | null;
  exitReason: string | null;
}

export interface PnlPoint {
  timestamp: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}

export interface BotEvent {
  id: string;
  level: "INFO" | "WARN" | "ERROR";
  category: string;
  message: string;
  context: Record<string, unknown>;
  createdAt: number;
}

export interface PnlSummary {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  openPositions: number;
}

export interface ConnectionHealth {
  connected: boolean;
  lastMessageAt: number | null;
  reconnectAttempts: number;
}

export interface RuntimeStatus {
  state: BotLifecycleState;
  startedAt: number | null;
  pausedReason: string | null;
  killReason: string | null;
  shadowMode: boolean;
  liveTrading: boolean;
  binance: ConnectionHealth;
  polymarketMarketWs: ConnectionHealth;
  polymarketUserWs: ConnectionHealth;
  discoveredMarkets: number;
  openOrders: number;
  pnl: PnlSummary;
}

export interface SignalMetricRecord {
  signalId: string;
  conditionId: string;
  marketLabel: string;
  intervalMinutes: 5 | 15;
  outcome: Outcome;
  binanceMoveDetectedAt: number;
  polymarketDetectedAt: number;
  estimatedDelayMs: number;
  binanceMoveBps: number;
  grossEdgeBps: number;
  netEdgeBps: number;
  spreadObserved: number;
  spreadObservedBps: number;
  slippageEstimatedBps: number;
  depthAvailable: number;
  decision: SignalDecision;
  skipReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SignalMetricsSummary {
  totalSignals: number;
  signalsExecuted: number;
  signalsDiscarded: number;
  signalsPerHour: number;
  enteredRate: number;
  skipRate: number;
  simulatedWins: number;
  simulatedLosses: number;
  simulatedWinRate: number;
  simulatedLossRate: number;
  avgGrossEdgeBps: number;
  avgNetEdgeBps: number;
  avgEstimatedDelayMs: number;
  expectancyPerSignal: number;
  expectancyPerExecutedTrade: number;
  distributionByMarket: Record<string, {
    total: number;
    entered: number;
    skipped: number;
    avgNetEdgeBps: number;
    medianNetEdgeBps: number;
    avgDelayMs: number;
    medianDelayMs: number;
  }>;
  distributionBySkipReason: Record<string, number>;
  topSkipReasons: Array<{
    reason: string;
    count: number;
  }>;
}

export interface MetricsBucketBreakdown {
  bucket: string;
  total: number;
  entered: number;
  skipped: number;
  avgNetEdgeBps: number;
}

export interface SignalMetricsBuckets {
  binanceMoveBps: MetricsBucketBreakdown[];
  estimatedDelayMs: MetricsBucketBreakdown[];
  netEdgeBps: MetricsBucketBreakdown[];
}

export type EdgeInterpretation = "edge prometedor" | "edge debil" | "insuficiente data";

export interface SignalMetricsAnalysis {
  interpretation: EdgeInterpretation;
  observedHours: number;
  totalSignals: number;
  signalsPerHour: number;
  enteredRate: number;
  skipRate: number;
  avgNetEdgeBps: number;
  expectancyPerSignal: number;
  expectancyPerExecutedTrade: number;
  simulatedWinRate: number;
  simulatedLossRate: number;
  strongestMarket: string | null;
  weakestMarket: string | null;
  notes: string[];
}
