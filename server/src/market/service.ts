import type { Candle } from "../types/contracts.js";
import type { MarketType, Timeframe } from "../types/market.js";
import { findInstrument } from "./catalog.js";
import { fetchBinanceCandles, fetchDerivCandles, fetchYahooCandles } from "./fetchers.js";

const BINANCE_FALLBACK_SYMBOLS: Record<string, string> = {
  EURUSD: "EURUSDT",
  GBPUSD: "GBPUSDT",
  AUDUSD: "AUDUSDT",
  NZDUSD: "NZDUSDT",
  XAUUSD: "PAXGUSDT"
};

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

  try {
    return await fetchYahooCandles(instrument, timeframe, limit);
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes("Yahoo data error: 429")) {
      throw error;
    }

    const fallbackSymbol = BINANCE_FALLBACK_SYMBOLS[symbol.toUpperCase()];
    if (!fallbackSymbol) {
      throw error;
    }

    return fetchBinanceCandles(
      {
        ...instrument,
        providerSymbol: fallbackSymbol
      },
      timeframe,
      limit
    );
  }
}
