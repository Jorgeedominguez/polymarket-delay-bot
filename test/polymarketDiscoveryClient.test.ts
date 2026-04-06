import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { PolymarketDiscoveryClient } from "../src/clients/polymarketDiscoveryClient";

describe("PolymarketDiscoveryClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges paginated markets and event markets without losing BTC updown entries", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);

      if (url.includes("/markets?")) {
        if (url.includes("offset=0")) {
          return {
            ok: true,
            json: async () => [
              {
                id: "market-1",
                slug: "other-market",
                question: "Other market",
                conditionId: "condition-1",
              },
            ],
          };
        }

        return {
          ok: true,
          json: async () => [],
        };
      }

      if (url.includes("/events?")) {
        if (url.includes("offset=0")) {
          return {
            ok: true,
            json: async () => [
              {
                id: "event-1",
                slug: "btc-updown-5m-1775505000",
                markets: [
                  {
                    id: "market-btc-5m",
                    slug: "btc-updown-5m-1775505000",
                    question: "Bitcoin Up or Down - Apr 6, 10:15 AM to 10:20 AM ET",
                    conditionId: "condition-btc-5m",
                  },
                ],
              },
            ],
          };
        }

        return {
          ok: true,
          json: async () => [],
        };
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new PolymarketDiscoveryClient("https://gamma-api.polymarket.com", pino({ enabled: false }));
    const markets = await client.listActiveMarkets(1);

    expect(markets).toHaveLength(2);
    const btcMarket = markets.find((market) => market.conditionId === "condition-btc-5m");
    expect(btcMarket).toBeDefined();
    expect(btcMarket?.events?.[0]?.slug).toBe("btc-updown-5m-1775505000");
  });
});
