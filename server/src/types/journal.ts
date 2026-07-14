import type { TradeDirection, TradeMode } from "./contracts.js";
import type { MarketType, Timeframe } from "./market.js";

export type TradeStatus = "OPEN" | "WON" | "LOST";

export type TradeRecord = {
  id: string;
  market: MarketType;
  symbol: string;
  timeframe: Timeframe;
  tradeMode: TradeMode;
  direction: TradeDirection;
  signalQuality: "LOW" | "MEDIUM" | "HIGH" | "PERFECT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;
  lotSize: number;
  openedAt: string;
  closedAt?: string;
  status: TradeStatus;
  closePrice?: number;
  pnlAmount?: number;
  pnlR?: number;
  source: "signal" | "auto-execution";
};

export type JournalStats = {
  total: number;
  open: number;
  won: number;
  lost: number;
  winRate: number;
  totalPnl: number;
  averageR: number;
};

export type SignalPayload = {
  snapshot: {
    market: MarketType;
    symbol: string;
    timeframe: Timeframe;
    candles: Array<{ high: number; low: number; close: number }>;
  };
  setup: {
    appliedMode: TradeMode;
    direction: TradeDirection;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    signalQuality: "LOW" | "MEDIUM" | "HIGH" | "PERFECT";
    futureEntries: Array<{
      orderType: "BUY_LIMIT" | "SELL_LIMIT";
      entry: number;
      stopLoss: number;
      takeProfit: number;
      rr: number;
      allocationPercent: number;
      expectedHold: string;
      rationale: string;
    }>;
  };
  risk: {
    riskAmount: number;
    lotSize: number;
  };
};
