import { Logger } from "pino";

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId?: string;
  condition_id?: string;
  clobTokenIds?: string[] | string;
  clob_token_ids?: string[] | string;
  outcomes?: string[] | string;
  active?: boolean;
  closed?: boolean;
}

export class PolymarketDiscoveryClient {
  constructor(
    private readonly gammaUrl: string,
    private readonly logger: Logger,
  ) {}

  async listActiveMarkets(limit = 500): Promise<GammaMarket[]> {
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

    this.logger.info({ component: "polymarketDiscovery", count: markets.length }, "Fetched active Gamma markets");
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
}
