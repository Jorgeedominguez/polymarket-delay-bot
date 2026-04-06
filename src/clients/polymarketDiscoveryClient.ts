import { Logger } from "pino";

export interface GammaEventReference {
  id?: string | number;
  slug?: string;
}

export interface GammaMarket {
  id: string;
  question?: string;
  slug?: string;
  ticker?: string;
  conditionId?: string;
  condition_id?: string;
  clobTokenIds?: string[] | string;
  clob_token_ids?: string[] | string;
  outcomes?: string[] | string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  events?: GammaEventReference[];
}

export interface GammaEvent {
  id: string | number;
  slug?: string;
  title?: string;
  markets?: GammaMarket[];
}

export class PolymarketDiscoveryClient {
  constructor(
    private readonly gammaUrl: string,
    private readonly logger: Logger,
  ) {}

  async listActiveMarkets(limit = 500): Promise<GammaMarket[]> {
    const directMarkets = await this.fetchAllMarketPages(limit);
    const eventMarkets = await this.fetchAllEventMarketPages(limit);
    const markets = this.deduplicateMarkets([...directMarkets, ...eventMarkets]);

    this.logger.info(
      {
        component: "polymarketDiscovery",
        directMarkets: directMarkets.length,
        eventMarkets: eventMarkets.length,
        deduplicatedMarkets: markets.length,
      },
      "Fetched active Gamma markets",
    );
    return markets;
  }

  async fetchMarketsPage(offset = 0, limit = 500): Promise<GammaMarket[]> {
    const url = new URL("/markets", this.gammaUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Gamma API error ${response.status} while fetching markets`);
    }

    return (await response.json()) as GammaMarket[];
  }

  async fetchEventsPage(offset = 0, limit = 500): Promise<GammaEvent[]> {
    const url = new URL("/events", this.gammaUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Gamma API error ${response.status} while fetching events`);
    }

    return (await response.json()) as GammaEvent[];
  }

  private async fetchAllMarketPages(limit: number): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;

    while (true) {
      const page = await this.fetchMarketsPage(offset, limit);
      markets.push(...page);

      if (page.length < limit) {
        break;
      }

      offset += limit;
    }

    return markets;
  }

  private async fetchAllEventMarketPages(limit: number): Promise<GammaMarket[]> {
    const markets: GammaMarket[] = [];
    let offset = 0;

    while (true) {
      const page = await this.fetchEventsPage(offset, limit);
      const flattened = page.flatMap((event) =>
        (event.markets ?? []).map((market) => ({
          ...market,
          events: this.mergeEventReferences(market.events, [{ id: event.id, slug: event.slug }]),
        })),
      );
      markets.push(...flattened);

      if (page.length < limit) {
        break;
      }

      offset += limit;
    }

    return markets;
  }

  private mergeEventReferences(
    base: GammaEventReference[] | undefined,
    extra: GammaEventReference[],
  ): GammaEventReference[] {
    const seen = new Set<string>();
    const merged = [...(base ?? []), ...extra];

    return merged.filter((eventRef) => {
      const key = `${eventRef.id ?? ""}:${eventRef.slug ?? ""}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return Boolean(eventRef.id ?? eventRef.slug);
    });
  }

  private deduplicateMarkets(markets: GammaMarket[]): GammaMarket[] {
    const deduplicated = new Map<string, GammaMarket>();

    for (const market of markets) {
      const conditionId = market.conditionId ?? market.condition_id;
      const key = conditionId || market.slug || market.id;
      const existing = deduplicated.get(key);

      if (!existing) {
        deduplicated.set(key, market);
        continue;
      }

      deduplicated.set(key, {
        ...existing,
        ...market,
        events: this.mergeEventReferences(existing.events, market.events ?? []),
      });
    }

    return [...deduplicated.values()];
  }
}
