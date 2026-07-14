export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type RiskInput = {
  accountBalance: number;
  riskPercent: number;
};

export type TradeMode = "scalp" | "day" | "swing" | "position";

export type AnalyzeRequest = {
  pair: string;
  timeframe: "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
  tradeMode?: TradeMode;
  candles: Candle[];
  risk: RiskInput;
  quoteCurrency?: string;
};

export type TradeDirection = "BUY" | "SELL" | "NEUTRAL";

export type FutureEntry = {
  orderType: "BUY_LIMIT" | "SELL_LIMIT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  allocationPercent: number;
  expectedHold: string;
  rationale: string;
};

export type SignalQuality = "LOW" | "MEDIUM" | "HIGH" | "PERFECT";

export type TradeSetup = {
  appliedMode: TradeMode;
  direction: TradeDirection;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  confidence: number;
  signalQuality: SignalQuality;
  reasons: string[];
  futureEntries: FutureEntry[];
};

export type PositionSizing = {
  riskAmount: number;
  stopDistancePips: number;
  lotSize: number;
  warnings: string[];
};
