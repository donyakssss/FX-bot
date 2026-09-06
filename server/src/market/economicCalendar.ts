import type { MarketType } from "../types/market.js";

export type CalendarImpact = "LOW" | "MEDIUM" | "HIGH";

export type EconomicEvent = {
  title: string;
  currency: string;
  impact: CalendarImpact;
  scheduledAt: string;
  source: string;
  country?: string;
};

export type NewsBlockDecision = {
  blocked: boolean;
  reason?: string;
  event?: EconomicEvent;
  minutesToEvent?: number;
  window: {
    preMinutes: number;
    postMinutes: number;
  };
};

type CachedCalendar = {
  expiresAt: number;
  events: EconomicEvent[];
};

const cacheTtlMs = Number(process.env.ECONOMIC_CALENDAR_CACHE_TTL_MS ?? 15 * 60_000);
const preMinutesDefault = Number(process.env.ECONOMIC_NEWS_PRE_MIN ?? 20);
const postMinutesDefault = Number(process.env.ECONOMIC_NEWS_POST_MIN ?? 35);
const newsBlockEnabled = process.env.ECONOMIC_NEWS_BLOCK_ENABLED !== "false";

const calendarCache: { value?: CachedCalendar } = {};
let inFlight: Promise<EconomicEvent[]> | undefined;

const impactFromRaw = (value: string): CalendarImpact => {
  const lower = value.toLowerCase();
  if (lower.includes("high") || lower.includes("red")) {
    return "HIGH";
  }
  if (lower.includes("med") || lower.includes("orange")) {
    return "MEDIUM";
  }
  return "LOW";
};

const readTag = (xml: string, tag: string): string => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return (match?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
};

const parseDateTime = (dateText: string, timeText: string): string | null => {
  if (!dateText) {
    return null;
  }

  const normalizedTime = timeText && timeText.toLowerCase() !== "all day" ? timeText : "12:00am";
  const candidate = `${dateText} ${normalizedTime}`.trim();

  const parsed = Date.parse(candidate);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  const fallback = Date.parse(dateText);
  if (Number.isFinite(fallback)) {
    return new Date(fallback).toISOString();
  }

  return null;
};

const parseXmlCalendar = (xml: string): EconomicEvent[] => {
  const blocks = xml.split(/<event>/i).slice(1);
  const events: EconomicEvent[] = [];

  for (const block of blocks) {
    const eventXml = block.split(/<\/event>/i)[0];
    const title = readTag(eventXml, "title");
    const country = readTag(eventXml, "country");
    const currency = (readTag(eventXml, "currency") || country).toUpperCase();
    const date = readTag(eventXml, "date");
    const time = readTag(eventXml, "time");
    const impactRaw = readTag(eventXml, "impact");

    if (!title || !currency || !date) {
      continue;
    }

    const scheduledAt = parseDateTime(date, time);
    if (!scheduledAt) {
      continue;
    }

    events.push({
      title,
      currency,
      country: country || undefined,
      impact: impactFromRaw(impactRaw),
      scheduledAt,
      source: "ForexFactory"
    });
  }

  return events.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
};

const fetchXmlFeed = async (): Promise<string> => {
  const feedUrl = process.env.ECONOMIC_CALENDAR_URL ?? "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent": "fx-bot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Calendar feed unavailable: ${response.status}`);
  }

  return response.text();
};

const fallbackMockEvents = (): EconomicEvent[] => [];

export const getEconomicCalendar = async (): Promise<EconomicEvent[]> => {
  const cached = calendarCache.value;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.events;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const xml = await fetchXmlFeed();
      const events = parseXmlCalendar(xml);
      const normalized = events.length > 0 ? events : fallbackMockEvents();

      calendarCache.value = {
        events: normalized,
        expiresAt: Date.now() + cacheTtlMs
      };

      return normalized;
    } catch {
      const fallback = fallbackMockEvents();
      calendarCache.value = {
        events: fallback,
        expiresAt: Date.now() + Math.min(60_000, cacheTtlMs)
      };
      return fallback;
    } finally {
      inFlight = undefined;
    }
  })();

  return inFlight;
};

const relevantCurrencies = (market: MarketType, symbol: string): string[] => {
  const upper = symbol.toUpperCase();

  if (market === "forex") {
    if (upper.length >= 6) {
      return [upper.slice(0, 3), upper.slice(3, 6)];
    }
    return ["USD"];
  }

  if (market === "metals") {
    return ["USD"];
  }

  if (market === "indices") {
    if (upper.startsWith("US")) return ["USD"];
    if (upper.startsWith("UK")) return ["GBP"];
    if (upper.startsWith("DE") || upper.startsWith("EU")) return ["EUR"];
    if (upper.startsWith("JP")) return ["JPY"];
    return ["USD"];
  }

  if (market === "crypto") {
    return ["USD"];
  }

  return [];
};

const distanceMinutes = (leftIso: string, rightMs: number): number => {
  const leftMs = Date.parse(leftIso);
  if (!Number.isFinite(leftMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((leftMs - rightMs) / 60_000);
};

export const getNewsBlockDecision = async (input: {
  market: MarketType;
  symbol: string;
  now?: Date;
  preMinutes?: number;
  postMinutes?: number;
}): Promise<NewsBlockDecision> => {
  const preMinutes = Number.isFinite(input.preMinutes) ? Number(input.preMinutes) : preMinutesDefault;
  const postMinutes = Number.isFinite(input.postMinutes) ? Number(input.postMinutes) : postMinutesDefault;

  if (!newsBlockEnabled) {
    return {
      blocked: false,
      window: { preMinutes, postMinutes }
    };
  }

  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const currencies = new Set(relevantCurrencies(input.market, input.symbol));
  const events = await getEconomicCalendar();

  const relevant = events
    .filter((event) => event.impact === "HIGH" && currencies.has(event.currency))
    .map((event) => ({ event, minutesToEvent: distanceMinutes(event.scheduledAt, nowMs) }))
    .filter((item) => Number.isFinite(item.minutesToEvent));

  const inWindow = relevant.find((item) => item.minutesToEvent >= -postMinutes && item.minutesToEvent <= preMinutes);

  if (!inWindow) {
    return {
      blocked: false,
      window: { preMinutes, postMinutes }
    };
  }

  const timingText =
    inWindow.minutesToEvent >= 0
      ? `in ${inWindow.minutesToEvent} min`
      : `${Math.abs(inWindow.minutesToEvent)} min ago`;

  return {
    blocked: true,
    reason: `High-impact ${inWindow.event.currency} event window active: ${inWindow.event.title} (${timingText})`,
    event: inWindow.event,
    minutesToEvent: inWindow.minutesToEvent,
    window: { preMinutes, postMinutes }
  };
};

export const getUpcomingEconomicEvents = async (input: {
  market: MarketType;
  symbol: string;
  horizonHours?: number;
}): Promise<EconomicEvent[]> => {
  const horizonHours = Number(input.horizonHours ?? 24);
  const nowMs = Date.now();
  const untilMs = nowMs + horizonHours * 60 * 60_000;
  const currencies = new Set(relevantCurrencies(input.market, input.symbol));

  const events = await getEconomicCalendar();

  return events
    .filter((event) => event.impact === "HIGH" && currencies.has(event.currency))
    .filter((event) => {
      const ms = Date.parse(event.scheduledAt);
      return Number.isFinite(ms) && ms >= nowMs && ms <= untilMs;
    })
    .slice(0, 20);
};
