import type { FundamentalContext, FundamentalHeadline } from "../types/contracts.js";
import type { MarketType } from "../types/market.js";

type CachedFundamentals = {
  expiresAt: number;
  value: FundamentalContext;
};

const cache = new Map<string, CachedFundamentals>();
const inFlight = new Map<string, Promise<FundamentalContext>>();
const ttlMs = Number(process.env.FUNDAMENTALS_CACHE_TTL_MS ?? 5 * 60_000);

const positiveKeywords = [
  "beats",
  "surge",
  "growth",
  "bullish",
  "rally",
  "upgrade",
  "easing",
  "cooling inflation",
  "rate cut",
  "expands"
];

const negativeKeywords = [
  "misses",
  "drop",
  "bearish",
  "selloff",
  "downgrade",
  "tightening",
  "hot inflation",
  "rate hike",
  "war",
  "recession",
  "crisis"
];

const highImpactKeywords = [
  "fed",
  "ecb",
  "boe",
  "boj",
  "fomc",
  "cpi",
  "nfp",
  "payrolls",
  "gdp",
  "interest rate",
  "inflation",
  "geopolitical"
];

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const scoreHeadline = (title: string): number => {
  const lower = title.toLowerCase();
  const positive = positiveKeywords.reduce((acc, key) => acc + (lower.includes(key) ? 1 : 0), 0);
  const negative = negativeKeywords.reduce((acc, key) => acc + (lower.includes(key) ? 1 : 0), 0);
  return positive - negative;
};

const classifyImpact = (headlines: FundamentalHeadline[]): "LOW" | "MEDIUM" | "HIGH" => {
  const impactHits = headlines.reduce((acc, item) => {
    const lower = item.title.toLowerCase();
    return acc + highImpactKeywords.reduce((inner, key) => inner + (lower.includes(key) ? 1 : 0), 0);
  }, 0);

  if (impactHits >= 3) {
    return "HIGH";
  }
  if (impactHits >= 1) {
    return "MEDIUM";
  }
  return "LOW";
};

const parseRssItems = (xml: string): FundamentalHeadline[] => {
  const items: FundamentalHeadline[] = [];
  const chunks = xml.split("<item>").slice(1);

  for (const chunk of chunks.slice(0, 8)) {
    const titleMatch = chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
    const linkMatch = chunk.match(/<link>(.*?)<\/link>/i);
    const pubDateMatch = chunk.match(/<pubDate>(.*?)<\/pubDate>/i);
    const sourceMatch = chunk.match(/<source[^>]*>(.*?)<\/source>/i);

    const rawTitle = titleMatch?.[1] ?? titleMatch?.[2] ?? "";
    if (!rawTitle) {
      continue;
    }

    const title = decodeHtml(rawTitle);
    const score = scoreHeadline(title);
    const sentiment = score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral";

    items.push({
      title,
      source: decodeHtml(sourceMatch?.[1] ?? "News"),
      url: decodeHtml(linkMatch?.[1] ?? ""),
      publishedAt: new Date(pubDateMatch?.[1] ?? Date.now()).toISOString(),
      sentiment
    });
  }

  return items;
};

const newsQueryFor = (market: MarketType, symbol: string): string => {
  const upper = symbol.toUpperCase();
  if (market === "forex") {
    return `${upper} forex central bank inflation interest rates`;
  }
  if (market === "crypto") {
    return `${upper} crypto regulation etf on-chain macro`;
  }
  if (market === "indices") {
    return `${upper} index earnings macro fed`;
  }
  if (market === "metals") {
    return `${upper} gold silver yields inflation geopolitical`;
  }
  return `${upper} synthetic index volatility market sentiment`;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const getFundamentalContext = async (market: MarketType, symbol: string): Promise<FundamentalContext> => {
  const key = `${market}:${symbol}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const active = inFlight.get(key);
  if (active) {
    return active;
  }

  const request = (async () => {
    try {
      const query = newsQueryFor(market, symbol);
      const endpoint = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetch(endpoint, { headers: { "User-Agent": "fx-bot/1.0" } });

      if (!response.ok) {
        throw new Error(`News feed unavailable: ${response.status}`);
      }

      const xml = await response.text();
      const headlines = parseRssItems(xml);

      const totalScore = headlines.reduce((acc, item) => {
        if (item.sentiment === "bullish") {
          return acc + 1;
        }
        if (item.sentiment === "bearish") {
          return acc - 1;
        }
        return acc;
      }, 0);

      const sentimentScore = headlines.length > 0 ? clamp(totalScore / headlines.length, -1, 1) : 0;
      const fundamentals: FundamentalContext = {
        symbol,
        market,
        sentimentScore: Number(sentimentScore.toFixed(2)),
        impact: classifyImpact(headlines),
        headlines,
        updatedAt: new Date().toISOString()
      };

      cache.set(key, {
        value: fundamentals,
        expiresAt: Date.now() + ttlMs
      });

      return fundamentals;
    } catch {
      const fallback: FundamentalContext = {
        symbol,
        market,
        sentimentScore: 0,
        impact: "LOW",
        headlines: [],
        updatedAt: new Date().toISOString()
      };
      cache.set(key, {
        value: fallback,
        expiresAt: Date.now() + Math.min(ttlMs, 60_000)
      });
      return fallback;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
};
