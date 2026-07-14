import type { Candle } from "./contracts.js";

export type MarketType = "forex" | "crypto" | "indices" | "metals" | "synthetics";

export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";

export type Instrument = {
  market: MarketType;
  symbol: string;
  displayName: string;
  providerSymbol: string;
};

export type LiveAnalyzeRequest = {
  market: MarketType;
  symbol: string;
  timeframe: Timeframe;
  tradeMode?: "scalp" | "day" | "swing" | "position";
  risk: {
    accountBalance: number;
    riskPercent: number;
  };
};

export type MarketSnapshot = {
  market: MarketType;
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
};
