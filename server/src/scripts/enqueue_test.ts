import { analyzeSetup } from "../strategy/index.js";
import { computePositionSizing } from "../risk/riskManager.js";
import { executeSignalOrder } from "../execution/executor.js";
import { getMarketCandles } from "../market/service.js";

const main = async () => {
  try {
    const candles = await getMarketCandles("forex", "EURUSD", "M15", 220).catch(() => null);
    const demo = candles && candles.length >= 20 ? candles : require("../../data/sample-candles.json");

    const setup = analyzeSetup({
      pair: "EURUSD",
      timeframe: "M15",
      tradeMode: "day",
      candles: demo,
      risk: { accountBalance: 10000, riskPercent: 5 },
      quoteCurrency: "USD"
    });

    const sizing = computePositionSizing({
      accountBalance: 10000,
      riskPercent: 5,
      entry: setup.entry,
      stopLoss: setup.stopLoss,
      pair: "EURUSD",
      quoteCurrency: "USD"
    });

    const payload = {
      snapshot: { market: "forex", symbol: "EURUSD", timeframe: "M15", candles: demo },
      setup,
      risk: sizing,
      updatedAt: new Date().toISOString()
    } as any;

    const result = await executeSignalOrder(payload, { oneTapEntry: true, enableTrailing: true, moveSlToBreakeven: true, significantShiftOnly: false, dryRun: false });
    console.log("Enqueue test result:", result);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

void main();
