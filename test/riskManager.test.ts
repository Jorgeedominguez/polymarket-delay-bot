import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env";
import { ExposureManager } from "../src/risk/exposureManager";
import { KillSwitch } from "../src/risk/killSwitch";
import { RiskManager } from "../src/risk/riskManager";
import { PositionRecord, TradeSignal } from "../src/persistence/models";

function buildSignal(): TradeSignal {
  return {
    id: "signal-1",
    createdAt: Date.now(),
    conditionId: "condition-1",
    intervalMinutes: 5,
    outcome: "YES",
    side: "BUY",
    referencePrice: 0.5,
    targetPrice: 0.56,
    bookPrice: 0.54,
    bestBid: 0.53,
    bestAsk: 0.54,
    expectedProbability: 0.58,
    executableSize: 10,
    depthAvailable: 10,
    notional: 5.4,
    grossEdgeBps: 740,
    netEdgeBps: 280,
    score: 0.9,
    stale: false,
    status: "approved",
    reasons: [],
    move: {
      direction: "UP",
      absoluteBps: 15,
      signedBps: 15,
      speedBpsPerSecond: 7.5,
      windowMs: 2000,
      startPrice: 100000,
      endPrice: 100150,
      startedAt: 1000,
      endedAt: 3000,
    },
  };
}

describe("RiskManager", () => {
  it("blocks entries when Polymarket WS is down", () => {
    const riskManager = new RiskManager(loadConfig(), new ExposureManager(), new KillSwitch());

    const decision = riskManager.evaluateEntry({
      signal: buildSignal(),
      market: {
        conditionId: "condition-1",
        marketId: "market-1",
        slug: "btc-5m",
        question: "Bitcoin Up or Down - 5 Minutes",
        intervalMinutes: 5,
        yesTokenId: "yes",
        noTokenId: "no",
        minimumTickSize: 0.01,
        minimumOrderSize: 1,
        takerFeeBps: 0,
        makerFeeBps: 0,
        active: true,
        closed: false,
        enableOrderBook: true,
        negRisk: false,
        lastDiscoveredAt: Date.now(),
      },
      positions: [],
      openOrders: [],
      binanceHealth: {
        connected: true,
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      },
      polymarketHealth: {
        connected: false,
        lastMessageAt: Date.now(),
        reconnectAttempts: 1,
      },
      pnlSummary: {
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        openPositions: 0,
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("polymarket_ws_down");
  });

  it("allows entries when the signal and infrastructure are healthy", () => {
    const riskManager = new RiskManager(loadConfig(), new ExposureManager(), new KillSwitch());

    const decision = riskManager.evaluateEntry({
      signal: buildSignal(),
      market: {
        conditionId: "condition-1",
        marketId: "market-1",
        slug: "btc-5m",
        question: "Bitcoin Up or Down - 5 Minutes",
        intervalMinutes: 5,
        yesTokenId: "yes",
        noTokenId: "no",
        minimumTickSize: 0.01,
        minimumOrderSize: 1,
        takerFeeBps: 0,
        makerFeeBps: 0,
        active: true,
        closed: false,
        enableOrderBook: true,
        negRisk: false,
        lastDiscoveredAt: Date.now(),
      },
      positions: [],
      openOrders: [],
      binanceHealth: {
        connected: true,
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      },
      polymarketHealth: {
        connected: true,
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      },
      pnlSummary: {
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        openPositions: 0,
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeNull();
  });

  it("uses a clearer reason when the single signal exceeds max total exposure on its own", () => {
    const riskManager = new RiskManager(
      loadConfig({ MAX_TOTAL_EXPOSURE: "5" }),
      new ExposureManager(),
      new KillSwitch(),
    );

    const decision = riskManager.evaluateEntry({
      signal: buildSignal(),
      market: {
        conditionId: "condition-1",
        marketId: "market-1",
        slug: "btc-5m",
        question: "Bitcoin Up or Down - 5 Minutes",
        intervalMinutes: 5,
        yesTokenId: "yes",
        noTokenId: "no",
        minimumTickSize: 0.01,
        minimumOrderSize: 1,
        takerFeeBps: 0,
        makerFeeBps: 0,
        active: true,
        closed: false,
        enableOrderBook: true,
        negRisk: false,
        lastDiscoveredAt: Date.now(),
      },
      positions: [],
      openOrders: [],
      binanceHealth: {
        connected: true,
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      },
      polymarketHealth: {
        connected: true,
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      },
      pnlSummary: {
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        openPositions: 0,
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("signal_notional_exceeds_max_total_exposure");
  });

  it("keeps max_total_exposure_reached for real pre-existing exposure", () => {
    const riskManager = new RiskManager(
      loadConfig({ MAX_TOTAL_EXPOSURE: "10" }),
      new ExposureManager(),
      new KillSwitch(),
    );

    const existingPosition: PositionRecord = {
      id: "position-1",
      conditionId: "other-condition",
      marketId: "market-1",
      assetId: "asset-1",
      intervalMinutes: 5,
      outcome: "YES",
      status: "OPEN",
      entryPrice: 0.5,
      currentPrice: 0.5,
      size: 12,
      entryNotional: 6.5,
      realizedPnl: 0,
      unrealizedPnl: 0,
      openedAt: Date.now(),
      updatedAt: Date.now(),
      closedAt: null,
      exitReason: null,
    };

    const decision = riskManager.evaluateEntry({
      signal: buildSignal(),
      market: {
        conditionId: "condition-1",
        marketId: "market-1",
        slug: "btc-5m",
        question: "Bitcoin Up or Down - 5 Minutes",
        intervalMinutes: 5,
        yesTokenId: "yes",
        noTokenId: "no",
        minimumTickSize: 0.01,
        minimumOrderSize: 1,
        takerFeeBps: 0,
        makerFeeBps: 0,
        active: true,
        closed: false,
        enableOrderBook: true,
        negRisk: false,
        lastDiscoveredAt: Date.now(),
      },
      positions: [existingPosition],
      openOrders: [],
      binanceHealth: {
        connected: true,
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      },
      polymarketHealth: {
        connected: true,
        lastMessageAt: Date.now(),
        reconnectAttempts: 0,
      },
      pnlSummary: {
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0,
        openPositions: 1,
      },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("max_total_exposure_reached");
  });
});
