import { GammaMarket } from "../clients/polymarketDiscoveryClient";
import { DiscoveredMarket, MarketMetadata, Outcome } from "../persistence/models";

export type BtcMarketMatchSource = "slug" | "ticker" | "events.slug" | "question";

export interface BtcMarketEvaluation {
  isCandidate: boolean;
  isTarget: boolean;
  intervalMinutes: 5 | 15 | null;
  matchedBy: BtcMarketMatchSource | null;
  matchedPattern: string | null;
  matchedValue: string | null;
  discardReason: string | null;
}

interface SearchField {
  source: BtcMarketMatchSource;
  value: string;
}

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

function parseNumber(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function collectSearchFields(market: GammaMarket): SearchField[] {
  const fields: SearchField[] = [];
  const push = (source: BtcMarketMatchSource, value: string | undefined): void => {
    if (!value) {
      return;
    }

    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    fields.push({ source, value: normalized });
  };

  push("slug", market.slug);
  push("ticker", market.ticker);

  for (const eventRef of market.events ?? []) {
    push("events.slug", eventRef.slug);
  }

  push("question", market.question);
  return fields;
}

function isPotentialBtcCandidate(value: string): boolean {
  const normalized = normalize(value);
  return (
    normalized.includes("btc") ||
    normalized.includes("bitcoin") ||
    normalized.includes("updown") ||
    normalized.includes("up or down") ||
    normalized.includes("up-or-down")
  );
}

function extractIntervalFromQuestion(question: string): 5 | 15 | null {
  const normalized = normalize(question);

  if (!normalized.includes("bitcoin") || !normalized.includes("up or down")) {
    return null;
  }

  if (/\b5m\b|\b5\s*minute(s)?\b/.test(normalized)) {
    return 5;
  }

  if (/\b15m\b|\b15\s*minute(s)?\b/.test(normalized)) {
    return 15;
  }

  const rangeMatch = question.match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(?:-|to)\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (!rangeMatch) {
    return null;
  }

  const [, startHourText, startMinuteText, startMeridiem, endHourText, endMinuteText, endMeridiem] = rangeMatch;
  const startMinutes = toClockMinutes(startHourText, startMinuteText, startMeridiem);
  const endMinutes = toClockMinutes(endHourText, endMinuteText, endMeridiem ?? startMeridiem);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const diff = (endMinutes - startMinutes + 24 * 60) % (24 * 60);
  if (diff === 5 || diff === 15) {
    return diff;
  }

  return null;
}

function toClockMinutes(
  hourText: string,
  minuteText: string,
  meridiem: string | undefined,
): number | null {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  if (!meridiem) {
    return hour * 60 + minute;
  }

  const normalizedMeridiem = meridiem.toUpperCase();
  const wrappedHour = hour % 12;
  return (normalizedMeridiem === "PM" ? wrappedHour + 12 : wrappedHour) * 60 + minute;
}

function matchSlugLikeValue(value: string): { intervalMinutes: 5 | 15; pattern: string } | null {
  const normalized = normalize(value);

  if (/btc-(updown|up-or-down)-5m(?:-|$)/.test(normalized)) {
    return {
      intervalMinutes: 5,
      pattern: "btc-updown-5m-*",
    };
  }

  if (/btc-(updown|up-or-down)-15m(?:-|$)/.test(normalized)) {
    return {
      intervalMinutes: 15,
      pattern: "btc-updown-15m-*",
    };
  }

  return null;
}

export function evaluateBtcTargetMarket(market: GammaMarket): BtcMarketEvaluation {
  const searchFields = collectSearchFields(market);
  const candidateFields = searchFields.filter((field) => isPotentialBtcCandidate(field.value));
  const conditionId = market.conditionId ?? market.condition_id;

  if (candidateFields.length === 0) {
    return {
      isCandidate: false,
      isTarget: false,
      intervalMinutes: null,
      matchedBy: null,
      matchedPattern: null,
      matchedValue: null,
      discardReason: "no_btc_markers",
    };
  }

  for (const field of searchFields) {
    if (field.source === "question") {
      const intervalMinutes = extractIntervalFromQuestion(field.value);
      if (intervalMinutes) {
        if (!conditionId) {
          return {
            isCandidate: true,
            isTarget: false,
            intervalMinutes,
            matchedBy: field.source,
            matchedPattern: "Bitcoin Up or Down - ...",
            matchedValue: field.value,
            discardReason: "missing_condition_id",
          };
        }

        if (market.acceptingOrders === false) {
          return {
            isCandidate: true,
            isTarget: false,
            intervalMinutes,
            matchedBy: field.source,
            matchedPattern: "Bitcoin Up or Down - ...",
            matchedValue: field.value,
            discardReason: "accepting_orders_false",
          };
        }

        return {
          isCandidate: true,
          isTarget: true,
          intervalMinutes,
          matchedBy: field.source,
          matchedPattern: "Bitcoin Up or Down - ...",
          matchedValue: field.value,
          discardReason: null,
        };
      }

      continue;
    }

    const slugLikeMatch = matchSlugLikeValue(field.value);
    if (slugLikeMatch) {
      if (!conditionId) {
        return {
          isCandidate: true,
          isTarget: false,
          intervalMinutes: slugLikeMatch.intervalMinutes,
          matchedBy: field.source,
          matchedPattern: slugLikeMatch.pattern,
          matchedValue: field.value,
          discardReason: "missing_condition_id",
        };
      }

      if (market.acceptingOrders === false) {
        return {
          isCandidate: true,
          isTarget: false,
          intervalMinutes: slugLikeMatch.intervalMinutes,
          matchedBy: field.source,
          matchedPattern: slugLikeMatch.pattern,
          matchedValue: field.value,
          discardReason: "accepting_orders_false",
        };
      }

      return {
        isCandidate: true,
        isTarget: true,
        intervalMinutes: slugLikeMatch.intervalMinutes,
        matchedBy: field.source,
        matchedPattern: slugLikeMatch.pattern,
        matchedValue: field.value,
        discardReason: null,
      };
    }
  }

  if (!conditionId) {
    return {
      isCandidate: true,
      isTarget: false,
      intervalMinutes: null,
      matchedBy: null,
      matchedPattern: null,
      matchedValue: null,
      discardReason: "missing_condition_id",
    };
  }

  if (market.acceptingOrders === false) {
    return {
      isCandidate: true,
      isTarget: false,
      intervalMinutes: null,
      matchedBy: null,
      matchedPattern: null,
      matchedValue: null,
      discardReason: "accepting_orders_false",
    };
  }

  return {
    isCandidate: true,
    isTarget: false,
    intervalMinutes: null,
    matchedBy: null,
    matchedPattern: null,
    matchedValue: null,
    discardReason: "no_supported_btc_updown_pattern",
  };
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
  return evaluateBtcTargetMarket(market).isTarget;
}

export function toDiscoveredMarket(
  market: GammaMarket,
  evaluation = evaluateBtcTargetMarket(market),
): DiscoveredMarket | null {
  const conditionId = market.conditionId ?? market.condition_id;
  if (!evaluation.isTarget || !evaluation.intervalMinutes || !conditionId) {
    return null;
  }

  return {
    conditionId,
    marketId: market.id,
    slug: market.slug ?? "",
    question: market.question ?? market.slug ?? market.ticker ?? "",
    intervalMinutes: evaluation.intervalMinutes,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    discoveredAt: Date.now(),
  };
}

export function toMarketMetadata(
  market: GammaMarket,
  clobMarket?: any,
  evaluation = evaluateBtcTargetMarket(market),
): MarketMetadata | null {
  const discovered = toDiscoveredMarket(market, evaluation);
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
    minimumTickSize: parseNumber(
      clobMarket?.minimum_tick_size ??
        market.orderPriceMinTickSize ??
        market.order_price_min_tick_size ??
        market.minimumTickSize ??
        market.minimum_tick_size,
      0.01,
    ),
    minimumOrderSize: parseNumber(
      clobMarket?.minimum_order_size ??
        market.orderMinSize ??
        market.order_min_size ??
        market.minimumOrderSize ??
        market.minimum_order_size,
      1,
    ),
    takerFeeBps: parseNumber(clobMarket?.taker_base_fee ?? market.takerBaseFee ?? market.taker_base_fee, 0),
    makerFeeBps: parseNumber(clobMarket?.maker_base_fee ?? market.makerBaseFee ?? market.maker_base_fee, 0),
    active: Boolean(clobMarket?.active ?? market.active ?? market.acceptingOrders ?? discovered.active),
    closed: Boolean(clobMarket?.closed ?? market.closed ?? discovered.closed),
    enableOrderBook: Boolean(clobMarket?.enable_order_book ?? market.enableOrderBook ?? market.enable_order_book ?? true),
    negRisk: Boolean(clobMarket?.neg_risk ?? market.negRisk ?? market.neg_risk ?? false),
    lastDiscoveredAt: Date.now(),
  };
}
