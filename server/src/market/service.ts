import type { Candle } from "../types/contracts.js";
import type { MarketType, Timeframe } from "../types/market.js";
import { findInstrument } from "./catalog.js";
import { fetchBinanceCandles, fetchDerivCandles, fetchYahooCandles } from "./fetchers.js";

export async function getMarketCandles(
  market: MarketType,
  symbol: string,
  timeframe: Timeframe,
  limit = 200
): Promise<Candle[]> {
  const instrument = findInstrument(market, symbol);

  if (!instrument) {
    throw new Error(`Unsupported instrument ${market}:${symbol}`);
  }

  if (market === "crypto") {
    return fetchBinanceCandles(instrument, timeframe, limit);
  }

  if (market === "synthetics") {
    return fetchDerivCandles(instrument, timeframe, limit);
  }

  return fetchYahooCandles(instrument, timeframe, limit);
}
