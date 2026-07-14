export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type AnalyzePayload = {
  pair: string;
  timeframe: "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
  candles: Candle[];
  risk: {
    accountBalance: number;
    riskPercent: number;
  };
  quoteCurrency?: string;
};

export type AnalyzeResponse = {
  meta: {
    pair: string;
    timeframe: string;
    model: string;
    note: string;
  };
  setup: {
    direction: "BUY" | "SELL" | "NEUTRAL";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    rr: number;
    confidence: number;
    reasons: string[];
  };
  risk: {
    riskAmount: number;
    stopDistancePips: number;
    lotSize: number;
    warnings: string[];
  };
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function analyzeMarket(payload: AnalyzePayload): Promise<AnalyzeResponse> {
  const response = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Analysis failed");
  }

  return (await response.json()) as AnalyzeResponse;
}
