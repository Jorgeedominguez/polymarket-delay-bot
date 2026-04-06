import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { PolymarketDiscoveryClient } from "../src/clients/polymarketDiscoveryClient";
import { evaluateBtcTargetMarket } from "../src/discovery/marketMapper";

describe("PolymarketDiscoveryClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retains only matched BTC event markets and stops early once limits are satisfied", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);

      if (url.includes("/events?") && url.includes("offset=0")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "event-1",
              slug: "btc-updown-5m-1775505000",
              markets: [
                {
                  id: "market-btc-5m-a",
                  slug: "btc-updown-5m-1775505000",
                  question: "Bitcoin Up or Down - Apr 6, 10:15 AM to 10:20 AM ET",
                  conditionId: "condition-btc-5m-a",
                  acceptingOrders: true,
                },
                {
                  id: "market-btc-15m-a",
                  slug: "btc-updown-15m-1775505900",
                  question: "Bitcoin Up or Down - Apr 6, 10:15 AM to 10:30 AM ET",
                  conditionId: "condition-btc-15m-a",
                  acceptingOrders: true,
                },
                {
                  id: "market-btc-5m-b",
                  slug: "btc-updown-5m-1775505300",
                  question: "Bitcoin Up or Down - Apr 6, 10:20 AM to 10:25 AM ET",
                  conditionId: "condition-btc-5m-b",
                  acceptingOrders: true,
                },
                {
                  id: "market-btc-15m-b",
                  slug: "btc-updown-15m-1775506800",
                  question: "Bitcoin Up or Down - Apr 6, 10:30 AM to 10:45 AM ET",
                  conditionId: "condition-btc-15m-b",
                  acceptingOrders: true,
                },
              ],
            },
          ],
        };
      }

      if (url.includes("/markets?")) {
        throw new Error("markets fallback should not run when events already found enough matches");
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new PolymarketDiscoveryClient("https://gamma-api.polymarket.com", pino({ enabled: false }));
    const result = await client.collectBtcMarkets(evaluateBtcTargetMarket, {
      pageSize: 100,
      maxRetainedMarkets: 4,
      maxRetainedPerInterval: 2,
    });

    expect(result.markets).toHaveLength(4);
    expect(result.stats.source).toBe("events");
    expect(result.stats.pagesConsulted).toBe(1);
    expect(result.stats.earlyStop).toBe(true);
    expect(result.stats.retainedByInterval[5]).toBe(2);
    expect(result.stats.retainedByInterval[15]).toBe(2);
  });

  it("falls back to /markets when /events does not surface BTC candidates", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);

      if (url.includes("/events?")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "event-1",
              slug: "other-event",
              markets: [{ id: "market-1", slug: "other-market", question: "Other market", conditionId: "condition-1" }],
            },
          ],
        };
      }

      if (url.includes("/markets?")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "market-btc-5m",
              slug: "btc-updown-5m-1775505000",
              question: "Unrelated phrasing",
              conditionId: "condition-btc-5m",
              acceptingOrders: true,
            },
          ],
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new PolymarketDiscoveryClient("https://gamma-api.polymarket.com", pino({ enabled: false }));
    const result = await client.collectBtcMarkets(evaluateBtcTargetMarket, {
      pageSize: 100,
      maxRetainedMarkets: 4,
      maxRetainedPerInterval: 2,
    });

    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]?.slug).toBe("btc-updown-5m-1775505000");
    expect(result.stats.source).toBe("events+markets");
    expect(result.stats.fallbackUsed).toBe(true);
  });
});
