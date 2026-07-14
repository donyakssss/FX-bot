const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type JournalStats = {
  total: number;
  open: number;
  won: number;
  lost: number;
  winRate: number;
  totalPnl: number;
  averageR: number;
};

export type TradeRecord = {
  id: string;
  market: string;
  symbol: string;
  timeframe: string;
  tradeMode: string;
  direction: string;
  signalQuality: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  lotSize: number;
  openedAt: string;
  closedAt?: string;
  status: "OPEN" | "WON" | "LOST";
  pnlAmount?: number;
  pnlR?: number;
  source: "signal" | "auto-execution";
};

export async function getJournalStats(): Promise<JournalStats> {
  const response = await fetch(`${API_BASE}/api/journal/stats`);
  if (!response.ok) {
    throw new Error("Failed to load journal stats");
  }
  const body = (await response.json()) as { stats: JournalStats };
  return body.stats;
}

export async function getRecentTrades(): Promise<TradeRecord[]> {
  const response = await fetch(`${API_BASE}/api/journal/trades`);
  if (!response.ok) {
    throw new Error("Failed to load trade journal");
  }
  const body = (await response.json()) as { trades: TradeRecord[] };
  return body.trades.slice(0, 12);
}

export async function getAutomationStatus(): Promise<{ enabled: boolean; broker: string }> {
  const response = await fetch(`${API_BASE}/api/automation/status`);
  if (!response.ok) {
    throw new Error("Failed to load automation status");
  }
  return (await response.json()) as { enabled: boolean; broker: string };
}
