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

export type ExecutionPreferences = {
  oneTapEntry?: boolean;
  enableTrailing?: boolean;
  moveSlToBreakeven?: boolean;
  significantShiftOnly?: boolean;
  dryRun?: boolean;
};

export type TradeMode = "scalp" | "day" | "swing" | "position";

export type AnalyzeRequest = {
  pair: string;
  timeframe: "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
  tradeMode?: TradeMode;
  strategy?: string;
  candles: Candle[];
  risk: RiskInput;
  quoteCurrency?: string;
  fundamentals?: FundamentalContext;
};

export type TradeDirection = "BUY" | "SELL" | "NEUTRAL";

export type FutureEntry = {
  orderType: "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  allocationPercent: number;
  expectedHold: string;
  rationale: string;
};

export type SignalQuality = "LOW" | "MEDIUM" | "HIGH" | "PERFECT";

export type MarketShiftAssessment = {
  significant: boolean;
  score: number;
  displacementRatio: number;
  trendStrength: number;
  volatilityExpansion: number;
  reasons: string[];
};

export type FundamentalHeadline = {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: "bullish" | "bearish" | "neutral";
};

export type FundamentalContext = {
  symbol: string;
  market: "forex" | "crypto" | "indices" | "metals" | "synthetics";
  sentimentScore: number;
  impact: "LOW" | "MEDIUM" | "HIGH";
  headlines: FundamentalHeadline[];
  updatedAt: string;
};

export type TradeSetup = {
  appliedMode: TradeMode;
  direction: TradeDirection;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  confidence: number;
  signalQuality: SignalQuality;
  marketShift: MarketShiftAssessment;
  fundamentals?: FundamentalContext;
  strategyVersion: string;
  reasons: string[];
  futureEntries: FutureEntry[];
  annotations?: Array<{ type: "SUPPORT" | "RESISTANCE" | "ENTRY" | "SL" | "TP" | "LIMIT" | "NOTE"; price: number; label?: string }>;
};

export type PositionSizing = {
  riskAmount: number;
  stopDistancePips: number;
  lotSize: number;
  warnings: string[];
};
