import { GammaMarket } from "../clients/polymarketDiscoveryClient";
import { DiscoveredMarket, MarketMetadata, Outcome } from "../persistence/models";

function parseJsonArray(value: string[] | string | undefined): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map(String);
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function extractInterval(question: string): 5 | 15 | null {
  const normalized = question.toLowerCase();

  if (normalized.includes("bitcoin") && normalized.includes("up or down") && normalized.includes("5 minute")) {
    return 5;
  }

  if (normalized.includes("bitcoin") && normalized.includes("up or down") && normalized.includes("15 minute")) {
    return 15;
  }

  return null;
}

function mapOutcomeTokenIds(market: GammaMarket): Record<Outcome, string> | null {
  const outcomes = parseJsonArray(market.outcomes);
  const tokenIds = parseJsonArray(market.clobTokenIds ?? market.clob_token_ids);

  if (outcomes.length !== tokenIds.length || outcomes.length < 2) {
    return null;
  }

  const outcomeMap = new Map<string, string>();
  outcomes.forEach((outcome, index) => {
    outcomeMap.set(outcome.trim().toUpperCase(), tokenIds[index]);
  });

  const yes = outcomeMap.get("YES");
  const no = outcomeMap.get("NO");
  if (!yes || !no) {
    return null;
  }

  return { YES: yes, NO: no };
}

export function isBtcTargetMarket(market: GammaMarket): boolean {
  return extractInterval(market.question ?? "") !== null;
}

export function toDiscoveredMarket(market: GammaMarket): DiscoveredMarket | null {
  const intervalMinutes = extractInterval(market.question ?? "");
  const conditionId = market.conditionId ?? market.condition_id;
  if (!intervalMinutes || !conditionId) {
    return null;
  }

  return {
    conditionId,
    marketId: market.id,
    slug: market.slug,
    question: market.question,
    intervalMinutes,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    discoveredAt: Date.now(),
  };
}

export function toMarketMetadata(
  market: GammaMarket,
  clobMarket: any,
): MarketMetadata | null {
  const discovered = toDiscoveredMarket(market);
  const outcomeTokenIds = mapOutcomeTokenIds(market);
  if (!discovered || !outcomeTokenIds) {
    return null;
  }

  return {
    conditionId: discovered.conditionId,
    marketId: discovered.marketId,
    slug: discovered.slug,
    question: discovered.question,
    intervalMinutes: discovered.intervalMinutes,
    yesTokenId: outcomeTokenIds.YES,
    noTokenId: outcomeTokenIds.NO,
    minimumTickSize: Number(clobMarket.minimum_tick_size ?? 0.01),
    minimumOrderSize: Number(clobMarket.minimum_order_size ?? 1),
    takerFeeBps: Number(clobMarket.taker_base_fee ?? 0),
    makerFeeBps: Number(clobMarket.maker_base_fee ?? 0),
    active: Boolean(clobMarket.active ?? discovered.active),
    closed: Boolean(clobMarket.closed ?? discovered.closed),
    enableOrderBook: Boolean(clobMarket.enable_order_book ?? true),
    negRisk: Boolean(clobMarket.neg_risk ?? false),
    lastDiscoveredAt: Date.now(),
  };
}
