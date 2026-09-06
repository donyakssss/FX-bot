import { io, type Socket } from "socket.io-client";
import { isInsecureApiBase, resolveApiBase } from "./base";

export type MarketType = "forex" | "crypto" | "indices" | "metals" | "synthetics";
export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
export type TradeMode = "scalp" | "day" | "swing" | "position";

export type ExecutionPreferences = {
  oneTapEntry?: boolean;
  enableTrailing?: boolean;
  moveSlToBreakeven?: boolean;
  significantShiftOnly?: boolean;
  dryRun?: boolean;
};

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type Instrument = {
  market: MarketType;
  symbol: string;
  displayName: string;
  providerSymbol: string;
};

export type LiveUpdate = {
  snapshot: {
    market: MarketType;
    symbol: string;
    timeframe: Timeframe;
    candles: Candle[];
  };
  setup: {
    appliedMode: TradeMode;
    direction: "BUY" | "SELL" | "NEUTRAL";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rr: number;
    confidence: number;
    signalQuality: "LOW" | "MEDIUM" | "HIGH" | "PERFECT";
    marketShift: {
      significant: boolean;
      score: number;
      displacementRatio: number;
      trendStrength: number;
      volatilityExpansion: number;
      reasons: string[];
    };
    strategyVersion: string;
    fundamentals?: {
      symbol: string;
      market: MarketType;
      sentimentScore: number;
      impact: "LOW" | "MEDIUM" | "HIGH";
      updatedAt: string;
      headlines: Array<{
        title: string;
        source: string;
        url: string;
        publishedAt: string;
        sentiment: "bullish" | "bearish" | "neutral";
      }>;
    };
    reasons: string[];
    futureEntries: Array<{
      orderType: "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP" | "BUY_MARKET" | "SELL_MARKET";
      entry: number;
      stopLoss: number;
      takeProfit: number;
      rr: number;
      allocationPercent: number;
      expectedHold: string;
      rationale: string;
    }>;
    annotations?: Array<{ type: "SUPPORT" | "RESISTANCE" | "ENTRY" | "SL" | "TP" | "LIMIT" | "NOTE"; price: number; label?: string }>;
  };
  risk: {
    riskAmount: number;
    stopDistancePips: number;
    lotSize: number;
    warnings: string[];
  };
  riskControls?: {
    newsBlock: {
      blocked: boolean;
      reason?: string;
      minutesToEvent?: number;
      window: {
        preMinutes: number;
        postMinutes: number;
      };
      event?: {
        title: string;
        currency: string;
        impact: "LOW" | "MEDIUM" | "HIGH";
        scheduledAt: string;
        source: string;
        country?: string;
      };
    };
  };
  updatedAt: string;
};

const API_BASE = resolveApiBase();

export const API_BASE_IS_INSECURE = isInsecureApiBase(API_BASE);

export async function getInstruments(): Promise<Instrument[]> {
  const response = await fetch(`${API_BASE}/api/instruments`);
  if (!response.ok) {
    throw new Error("Failed to load instruments");
  }
  const body = (await response.json()) as { instruments: Instrument[] };
  return body.instruments;
}

export async function analyzeLive(payload: {
  market: MarketType;
  symbol: string;
  timeframe: Timeframe;
  tradeMode: TradeMode;
  risk: { accountBalance: number; riskPercent: number };
  execution?: ExecutionPreferences;
}): Promise<LiveUpdate> {
  const response = await fetch(`${API_BASE}/api/analyze-live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Live analysis failed");
  }

  const body = (await response.json()) as Omit<LiveUpdate, "updatedAt">;
  return {
    ...body,
    updatedAt: new Date().toISOString()
  };
}

export function connectLiveSocket(): Socket {
  return io(API_BASE, {
    transports: ["websocket", "polling"]
  });
}
