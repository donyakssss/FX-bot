import type { Timeframe } from "../types/market.js";

export const timeframeToSeconds = (timeframe: Timeframe): number => {
  switch (timeframe) {
    case "M1":
      return 60;
    case "M5":
      return 300;
    case "M15":
      return 900;
    case "M30":
      return 1800;
    case "H1":
      return 3600;
    case "H4":
      return 14400;
    case "D1":
      return 86400;
    default:
      return 900;
  }
};

export const timeframeToBinance = (timeframe: Timeframe): string => {
  switch (timeframe) {
    case "M1":
      return "1m";
    case "M5":
      return "5m";
    case "M15":
      return "15m";
    case "M30":
      return "30m";
    case "H1":
      return "1h";
    case "H4":
      return "4h";
    case "D1":
      return "1d";
    default:
      return "15m";
  }
};

export const timeframeToYahoo = (timeframe: Timeframe): { interval: string; range: string } => {
  switch (timeframe) {
    case "M1":
      return { interval: "1m", range: "7d" };
    case "M5":
      return { interval: "5m", range: "5d" };
    case "M15":
      return { interval: "15m", range: "1mo" };
    case "M30":
      return { interval: "30m", range: "1mo" };
    case "H1":
      return { interval: "60m", range: "3mo" };
    case "H4":
      return { interval: "1h", range: "6mo" };
    case "D1":
      return { interval: "1d", range: "2y" };
    default:
      return { interval: "15m", range: "1mo" };
  }
};
