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
  orderPriceMinTickSize?: number | string;
  order_price_min_tick_size?: number | string;
  minimumTickSize?: number | string;
  minimum_tick_size?: number | string;
  orderMinSize?: number | string;
  order_min_size?: number | string;
  minimumOrderSize?: number | string;
  minimum_order_size?: number | string;
  makerBaseFee?: number | string;
  maker_base_fee?: number | string;
  takerBaseFee?: number | string;
  taker_base_fee?: number | string;
  enableOrderBook?: boolean;
  enable_order_book?: boolean;
  negRisk?: boolean;
  neg_risk?: boolean;
}

export interface GammaEvent {
  id: string | number;
  slug?: string;
  title?: string;
  markets?: GammaMarket[];
}

export interface GammaMarketAssessment {
  isCandidate: boolean;
  isTarget: boolean;
  intervalMinutes: 5 | 15 | null;
}

export interface BtcMarketScanOptions {
  pageSize?: number;
  maxRetainedMarkets?: number;
  maxRetainedPerInterval?: number;
  fallbackToMarkets?: boolean;
}

export interface BtcMarketScanStats {
  source: "events" | "markets" | "events+markets";
  pageSize: number;
  pagesConsulted: number;
  marketsScanned: number;
  candidatesSeen: number;
  candidatesRetained: number;
  retainedByInterval: Record<5 | 15, number>;
  earlyStop: boolean;
  fallbackUsed: boolean;
}

export interface BtcMarketScanResult {
  markets: GammaMarket[];
  stats: BtcMarketScanStats;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETAINED_MARKETS = 8;
const DEFAULT_MAX_RETAINED_PER_INTERVAL = 4;
const MB = 1024 * 1024;

export class PolymarketDiscoveryClient {
  constructor(
    private readonly gammaUrl: string,
    private readonly logger: Logger,
  ) {}

  async collectBtcMarkets(
    assessMarket: (market: GammaMarket) => GammaMarketAssessment,
    options: BtcMarketScanOptions = {},
  ): Promise<BtcMarketScanResult> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const maxRetainedMarkets = options.maxRetainedMarkets ?? DEFAULT_MAX_RETAINED_MARKETS;
    const maxRetainedPerInterval = options.maxRetainedPerInterval ?? DEFAULT_MAX_RETAINED_PER_INTERVAL;
    const fallbackToMarkets = options.fallbackToMarkets ?? true;

    const fromEvents = await this.scanSource("events", assessMarket, {
      pageSize,
      maxRetainedMarkets,
      maxRetainedPerInterval,
    });

    if (fromEvents.stats.earlyStop || fromEvents.markets.length > 0 || !fallbackToMarkets) {
      return fromEvents;
    }

    const fromMarkets = await this.scanSource("markets", assessMarket, {
      pageSize,
      maxRetainedMarkets,
      maxRetainedPerInterval,
    });

    return {
      markets: fromMarkets.markets,
      stats: {
        source: "events+markets",
        pageSize,
        pagesConsulted: fromEvents.stats.pagesConsulted + fromMarkets.stats.pagesConsulted,
        marketsScanned: fromEvents.stats.marketsScanned + fromMarkets.stats.marketsScanned,
        candidatesSeen: fromEvents.stats.candidatesSeen + fromMarkets.stats.candidatesSeen,
        candidatesRetained: fromMarkets.stats.candidatesRetained,
        retainedByInterval: fromMarkets.stats.retainedByInterval,
        earlyStop: fromMarkets.stats.earlyStop,
        fallbackUsed: true,
      },
    };
  }

  async fetchMarketsPage(offset = 0, limit = DEFAULT_PAGE_SIZE): Promise<GammaMarket[]> {
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

  async fetchEventsPage(offset = 0, limit = DEFAULT_PAGE_SIZE): Promise<GammaEvent[]> {
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

  private async scanSource(
    source: "events" | "markets",
    assessMarket: (market: GammaMarket) => GammaMarketAssessment,
    options: Required<Pick<BtcMarketScanOptions, "pageSize" | "maxRetainedMarkets" | "maxRetainedPerInterval">>,
  ): Promise<BtcMarketScanResult> {
    const retained = new Map<string, GammaMarket>();
    const retainedByInterval: Record<5 | 15, number> = { 5: 0, 15: 0 };
    let offset = 0;
    let pagesConsulted = 0;
    let marketsScanned = 0;
    let candidatesSeen = 0;
    let earlyStop = false;

    while (true) {
      const pageMarkets =
        source === "events"
          ? this.flattenEventMarkets(await this.fetchEventsPage(offset, options.pageSize))
          : (await this.fetchMarketsPage(offset, options.pageSize)).map((market) => this.projectMarket(market));

      pagesConsulted += 1;
      marketsScanned += pageMarkets.length;

      for (const market of pageMarkets) {
        const assessment = assessMarket(market);
        if (!assessment.isCandidate) {
          continue;
        }

        candidatesSeen += 1;

        if (!assessment.isTarget || !assessment.intervalMinutes) {
          continue;
        }

        const key = this.toMarketKey(market);
        if (retained.has(key)) {
          continue;
        }

        if (retained.size >= options.maxRetainedMarkets) {
          earlyStop = true;
          break;
        }

        if (retainedByInterval[assessment.intervalMinutes] >= options.maxRetainedPerInterval) {
          continue;
        }

        retained.set(key, market);
        retainedByInterval[assessment.intervalMinutes] += 1;

        if (
          retainedByInterval[5] >= options.maxRetainedPerInterval &&
          retainedByInterval[15] >= options.maxRetainedPerInterval
        ) {
          earlyStop = true;
          break;
        }
      }

      this.logger.info(
        {
          component: "polymarketDiscovery",
          source,
          page: pagesConsulted,
          offset,
          pageSize: options.pageSize,
          pageMarkets: pageMarkets.length,
          marketsScanned,
          candidatesSeen,
          candidatesRetained: retained.size,
          retainedByInterval,
          earlyStop,
          ...this.getMemorySnapshot(),
        },
        "Scanned Gamma discovery page",
      );

      if (earlyStop || pageMarkets.length < options.pageSize) {
        break;
      }

      offset += options.pageSize;
    }

    return {
      markets: [...retained.values()],
      stats: {
        source,
        pageSize: options.pageSize,
        pagesConsulted,
        marketsScanned,
        candidatesSeen,
        candidatesRetained: retained.size,
        retainedByInterval,
        earlyStop,
        fallbackUsed: false,
      },
    };
  }

  private flattenEventMarkets(events: GammaEvent[]): GammaMarket[] {
    const markets: GammaMarket[] = [];

    for (const event of events) {
      for (const market of event.markets ?? []) {
        markets.push(this.projectMarket(market, { id: event.id, slug: event.slug }));
      }
    }

    return markets;
  }

  private projectMarket(market: GammaMarket, eventRef?: GammaEventReference): GammaMarket {
    return {
      id: String(market.id),
      question: market.question,
      slug: market.slug,
      ticker: market.ticker,
      conditionId: market.conditionId,
      condition_id: market.condition_id,
      clobTokenIds: market.clobTokenIds,
      clob_token_ids: market.clob_token_ids,
      outcomes: market.outcomes,
      active: market.active,
      closed: market.closed,
      acceptingOrders: market.acceptingOrders,
      events: this.mergeEventReferences(market.events, eventRef ? [eventRef] : []),
      orderPriceMinTickSize: market.orderPriceMinTickSize,
      order_price_min_tick_size: market.order_price_min_tick_size,
      minimumTickSize: market.minimumTickSize,
      minimum_tick_size: market.minimum_tick_size,
      orderMinSize: market.orderMinSize,
      order_min_size: market.order_min_size,
      minimumOrderSize: market.minimumOrderSize,
      minimum_order_size: market.minimum_order_size,
      makerBaseFee: market.makerBaseFee,
      maker_base_fee: market.maker_base_fee,
      takerBaseFee: market.takerBaseFee,
      taker_base_fee: market.taker_base_fee,
      enableOrderBook: market.enableOrderBook,
      enable_order_book: market.enable_order_book,
      negRisk: market.negRisk,
      neg_risk: market.neg_risk,
    };
  }

  private mergeEventReferences(
    base: GammaEventReference[] | undefined,
    extra: GammaEventReference[],
  ): GammaEventReference[] {
    const seen = new Set<string>();
    const merged = [...(base ?? []), ...extra];

    return merged.filter((eventRef) => {
      const key = `${eventRef.id ?? ""}:${eventRef.slug ?? ""}`;
      if (!eventRef.id && !eventRef.slug) {
        return false;
      }

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private toMarketKey(market: GammaMarket): string {
    return market.conditionId ?? market.condition_id ?? market.slug ?? market.id;
  }

  private getMemorySnapshot(): Record<string, number> {
    const usage = process.memoryUsage();
    return {
      rssMb: Number((usage.rss / MB).toFixed(1)),
      heapUsedMb: Number((usage.heapUsed / MB).toFixed(1)),
      heapTotalMb: Number((usage.heapTotal / MB).toFixed(1)),
    };
  }
}
