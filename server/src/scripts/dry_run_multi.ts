import { analyzeSetup } from "../strategy/index.js";
import { computePositionSizing } from "../risk/riskManager.js";
import { executeSignalOrder } from "../execution/executor.js";
import { getMarketCandles } from "../market/service.js";

const TARGETS = [
  { market: "forex", symbol: "EURUSD", timeframe: "M15" },
  { market: "forex", symbol: "GBPUSD", timeframe: "H1" },
  { market: "crypto", symbol: "BTCUSDT", timeframe: "H1" },
  { market: "metals", symbol: "XAUUSD", timeframe: "H4" }
];

async function runOne(t: { market: string; symbol: string; timeframe: string }) {
  try {
    const candles = await getMarketCandles(t.market as any, t.symbol, t.timeframe as any, 220).catch(() => null);
    const demo = candles && candles.length >= 20 ? candles : (await import("../../data/sample-candles.json")).default;

    const setup = analyzeSetup({ pair: t.symbol, timeframe: t.timeframe as any, tradeMode: "day", candles: demo, risk: { accountBalance: 10000, riskPercent: 5 } });
    const sizing = computePositionSizing({ accountBalance: 10000, riskPercent: 5, entry: setup.entry, stopLoss: setup.stopLoss, pair: t.symbol, quoteCurrency: "USD" });

    const payload = { snapshot: { market: t.market as any, symbol: t.symbol, timeframe: t.timeframe as any, candles: demo }, setup, risk: sizing, updatedAt: new Date().toISOString() } as any;

    const res = await executeSignalOrder(payload, { oneTapEntry: true, enableTrailing: true, moveSlToBreakeven: true, significantShiftOnly: false, dryRun: true });
    console.log(t.symbol, "->", res);
    return res;
  } catch (err) {
    console.error("Error for", t.symbol, err);
    return null;
  }
}

async function main() {
  for (const t of TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    await runOne(t);
  }
}

void main();
