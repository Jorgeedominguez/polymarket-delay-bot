import { describe, expect, it } from "vitest";
import { GammaMarket } from "../src/clients/polymarketDiscoveryClient";
import { evaluateBtcTargetMarket, toDiscoveredMarket } from "../src/discovery/marketMapper";

function buildMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: "market-1",
    slug: "btc-updown-5m-1775505000",
    question: "Some unrelated question",
    conditionId: "condition-1",
    active: true,
    closed: false,
    acceptingOrders: true,
    ...overrides,
  };
}

describe("marketMapper BTC discovery", () => {
  it("matches BTC 5m by slug", () => {
    const evaluation = evaluateBtcTargetMarket(
      buildMarket({
        slug: "btc-updown-5m-1775505000",
        question: "Will some unrelated thing happen?",
      }),
    );

    expect(evaluation.isTarget).toBe(true);
    expect(evaluation.intervalMinutes).toBe(5);
    expect(evaluation.matchedBy).toBe("slug");
    expect(evaluation.matchedPattern).toBe("btc-updown-5m-*");
  });

  it("matches BTC 15m by event slug", () => {
    const evaluation = evaluateBtcTargetMarket(
      buildMarket({
        slug: "not-btc",
        events: [{ slug: "btc-updown-15m-1775505900" }],
      }),
    );

    expect(evaluation.isTarget).toBe(true);
    expect(evaluation.intervalMinutes).toBe(15);
    expect(evaluation.matchedBy).toBe("events.slug");
    expect(evaluation.matchedPattern).toBe("btc-updown-15m-*");
  });

  it("matches Bitcoin Up or Down questions by time window", () => {
    const evaluation = evaluateBtcTargetMarket(
      buildMarket({
        slug: "generic-market",
        question: "Bitcoin Up or Down - Apr 6, 10:15 AM to 10:20 AM ET",
      }),
    );

    expect(evaluation.isTarget).toBe(true);
    expect(evaluation.intervalMinutes).toBe(5);
    expect(evaluation.matchedBy).toBe("question");
    expect(evaluation.matchedPattern).toBe("Bitcoin Up or Down - ...");
  });

  it("discards matched BTC candidates that are not accepting orders", () => {
    const evaluation = evaluateBtcTargetMarket(
      buildMarket({
        slug: "btc-updown-5m-1775505000",
        acceptingOrders: false,
      }),
    );

    expect(evaluation.isCandidate).toBe(true);
    expect(evaluation.isTarget).toBe(false);
    expect(evaluation.discardReason).toBe("accepting_orders_false");
  });

  it("maps discovered markets using evaluated interval instead of question text", () => {
    const market = buildMarket({
      slug: "btc-updown-15m-1775505900",
      question: "Will BTC end higher?",
    });
    const evaluation = evaluateBtcTargetMarket(market);
    const discovered = toDiscoveredMarket(market, evaluation);

    expect(discovered).not.toBeNull();
    expect(discovered?.intervalMinutes).toBe(15);
    expect(discovered?.slug).toBe("btc-updown-15m-1775505900");
  });
});
