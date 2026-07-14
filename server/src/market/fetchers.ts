import WebSocket from "ws";
import type { Candle } from "../types/contracts.js";
import type { Instrument, Timeframe } from "../types/market.js";
import { timeframeToBinance, timeframeToSeconds, timeframeToYahoo } from "./timeframes.js";

const toIso = (seconds: number): string => new Date(seconds * 1000).toISOString();

const numeric = (v: unknown): number => Number(v ?? 0);

const normalizeCandles = (candles: Candle[], limit: number): Candle[] => candles.slice(-limit);

export async function fetchBinanceCandles(
  instrument: Instrument,
  timeframe: Timeframe,
  limit: number
): Promise<Candle[]> {
  const interval = timeframeToBinance(timeframe);
  const endpoint = `https://api.binance.com/api/v3/klines?symbol=${instrument.providerSymbol}&interval=${interval}&limit=${Math.min(limit, 500)}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Binance data error: ${response.status}`);
  }

  const payload = (await response.json()) as Array<[number, string, string, string, string, string]>;
  return payload.map((k) => ({
    time: new Date(k[0]).toISOString(),
    open: numeric(k[1]),
    high: numeric(k[2]),
    low: numeric(k[3]),
    close: numeric(k[4]),
    volume: numeric(k[5])
  }));
}

export async function fetchYahooCandles(
  instrument: Instrument,
  timeframe: Timeframe,
  limit: number
): Promise<Candle[]> {
  const tf = timeframeToYahoo(timeframe);
  const endpoint = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.providerSymbol)}?interval=${tf.interval}&range=${tf.range}`;
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "fx-bot/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo data error: ${response.status}`);
  }

  const payload = (await response.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          quote: Array<{
            open: Array<number | null>;
            high: Array<number | null>;
            low: Array<number | null>;
            close: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = payload.chart.result?.[0];
  if (!result) {
    return [];
  }

  const quote = result.indicators.quote[0];
  const candles: Candle[] = [];

  for (let i = 0; i < result.timestamp.length; i += 1) {
    const open = quote.open[i];
    const high = quote.high[i];
    const low = quote.low[i];
    const close = quote.close[i];

    if (open == null || high == null || low == null || close == null) {
      continue;
    }

    candles.push({
      time: toIso(result.timestamp[i]),
      open,
      high,
      low,
      close,
      volume: quote.volume?.[i] ?? undefined
    });
  }

  return normalizeCandles(candles, limit);
}

export async function fetchDerivCandles(
  instrument: Instrument,
  timeframe: Timeframe,
  limit: number
): Promise<Candle[]> {
  const granularity = timeframeToSeconds(timeframe);
  const wsUrl = "wss://ws.derivws.com/websockets/v3?app_id=1089";

  return new Promise<Candle[]>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          ticks_history: instrument.providerSymbol,
          style: "candles",
          granularity,
          count: Math.min(limit, 500),
          end: "latest"
        })
      );
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          error?: { message: string };
          candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
        };

        if (msg.error) {
          reject(new Error(`Deriv data error: ${msg.error.message}`));
          ws.close();
          return;
        }

        if (!msg.candles) {
          return;
        }

        const candles: Candle[] = msg.candles.map((c) => ({
          time: toIso(c.epoch),
          open: numeric(c.open),
          high: numeric(c.high),
          low: numeric(c.low),
          close: numeric(c.close)
        }));

        resolve(normalizeCandles(candles, limit));
        ws.close();
      } catch (error) {
        reject(error as Error);
        ws.close();
      }
    });

    ws.on("error", (error) => reject(error));
  });
}
