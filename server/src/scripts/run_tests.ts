import assert from "assert";
import { analyzeSetup } from "../strategy/malaysianSnrStrategy.js";
import { computePositionSizing } from "../risk/riskManager.js";

function makeCandles(base = 1.1, count = 120) {
  const now = Date.now();
  const candles = [] as any[];
  for (let i = 0; i < count; i++) {
    const open = base + Math.sin(i / 6) * 0.002 + (Math.random() - 0.5) * 0.0005;
    const close = open + (Math.random() - 0.5) * 0.001;
    const high = Math.max(open, close) + Math.random() * 0.0008;
    const low = Math.min(open, close) - Math.random() * 0.0008;
    candles.push({ time: new Date(now - (count - i) * 60000).toISOString(), open, high, low, close, volume: 10 });
  }
  return candles;
}

async function run() {
  console.log("Running lightweight tests...");
  const candles = makeCandles(1.12, 220);

  const setup = analyzeSetup({ pair: "EURUSD", timeframe: "M15", tradeMode: "day", candles, risk: { accountBalance: 10000, riskPercent: 5 } });
  assert(setup.futureEntries, "setup.futureEntries must exist");
  console.log("analyzeSetup produced", setup.futureEntries.length, "future entries, confidence", setup.confidence);

  const sizing = computePositionSizing({ accountBalance: 10000, riskPercent: 5, entry: setup.entry, stopLoss: setup.stopLoss, pair: "EURUSD", quoteCurrency: "USD" });
  assert(typeof sizing.lotSize === "number", "sizing.lotSize must be numeric");
  console.log("computePositionSizing returned lotSize", sizing.lotSize, "warnings", sizing.warnings.length);

  if (sizing.warnings.length > 0) console.warn("Sizing warnings:", sizing.warnings.join("; "));

  console.log("All tests passed.");
}

run().catch((err) => {
  console.error(err);
  process.exit(2);
});
