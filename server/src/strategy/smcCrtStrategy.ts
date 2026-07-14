import type { AnalyzeRequest, Candle, FutureEntry, SignalQuality, TradeDirection, TradeMode, TradeSetup } from "../types/contracts.js";

const round = (value: number, digits = 5): number => Number(value.toFixed(digits));

const avg = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

const getRange = (candle: Candle): number => candle.high - candle.low;

const findSwingHigh = (candles: Candle[]): number => Math.max(...candles.map((c) => c.high));

const findSwingLow = (candles: Candle[]): number => Math.min(...candles.map((c) => c.low));

const detectOrderBlock = (candles: Candle[]): { bullish: number; bearish: number } => {
  const sample = candles.slice(-10);
  const bearishBody = sample
    .filter((c) => c.close < c.open)
    .sort((a, b) => Math.abs(b.open - b.close) - Math.abs(a.open - a.close))[0];

  const bullishBody = sample
    .filter((c) => c.close > c.open)
    .sort((a, b) => Math.abs(b.open - b.close) - Math.abs(a.open - a.close))[0];

  return {
    bullish: bullishBody ? bullishBody.open : sample[sample.length - 1].open,
    bearish: bearishBody ? bearishBody.open : sample[sample.length - 1].open
  };
};

const detectDirection = (candles: Candle[]): TradeDirection => {
  const recent = candles.slice(-14);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);

  const risingHighs = highs[highs.length - 1] > highs[0];
  const risingLows = lows[lows.length - 1] > lows[0];
  const fallingHighs = highs[highs.length - 1] < highs[0];
  const fallingLows = lows[lows.length - 1] < lows[0];

  if (risingHighs && risingLows) {
    return "BUY";
  }
  if (fallingHighs && fallingLows) {
    return "SELL";
  }
  return "NEUTRAL";
};

export const analyzeSetup = (request: AnalyzeRequest): TradeSetup => {
  const candles = request.candles;
  const latest = candles[candles.length - 1];
  const inferredMode: TradeMode = request.timeframe === "H4" || request.timeframe === "D1" ? "swing" : "day";
  const appliedMode = request.tradeMode ?? inferredMode;
  const isLongTerm = appliedMode === "swing" || appliedMode === "position";
  const modeWindow = appliedMode === "position" ? 70 : appliedMode === "swing" ? 60 : appliedMode === "day" ? 30 : 20;
  const stopMult = appliedMode === "position" ? 1.8 : appliedMode === "swing" ? 1.5 : appliedMode === "day" ? 1.1 : 0.8;
  const tpMult = appliedMode === "position" ? 3.8 : appliedMode === "swing" ? 3.2 : appliedMode === "day" ? 2.2 : 1.6;
  const holdText =
    appliedMode === "position"
      ? "5-20 days"
      : appliedMode === "swing"
        ? "2-10 days"
        : appliedMode === "day"
          ? "4-24 hours"
          : "15 minutes-4 hours";

  const structureWindow = candles.slice(-modeWindow);
  const avgRange = avg(structureWindow.slice(-20).map(getRange));

  const direction = detectDirection(candles);
  const swings = {
    high: findSwingHigh(structureWindow),
    low: findSwingLow(structureWindow)
  };
  const ob = detectOrderBlock(structureWindow);

  const displacement = Math.abs(latest.close - candles[candles.length - 2].close);
  const crtExpansion = displacement > avgRange * (isLongTerm ? 0.6 : 0.8);
  const firstHalf = structureWindow.slice(0, Math.floor(structureWindow.length / 2));
  const secondHalf = structureWindow.slice(Math.floor(structureWindow.length / 2));
  const rangeCompression = avg(firstHalf.map(getRange)) < avg(secondHalf.map(getRange));

  const reasons: string[] = [];
  if (crtExpansion) reasons.push("CRT expansion detected (strong displacement candle)");
  if (rangeCompression) reasons.push("CRT range shift indicates momentum transition");
  reasons.push(`Mode: ${appliedMode.toUpperCase()} analysis profile active`);

  let entry = latest.close;
  let stopLoss = latest.low;
  let takeProfit = latest.high;
  const futureEntries: FutureEntry[] = [];

  if (direction === "BUY") {
    entry = (latest.close + ob.bullish) / 2;
    stopLoss = Math.min(swings.low, entry - avgRange * stopMult);
    takeProfit = entry + (entry - stopLoss) * tpMult;
    reasons.push("Bullish structure detected with higher highs and higher lows");
    reasons.push("Displacement supports continuation and validates buy-side pressure");
    const ladderEntries =
      appliedMode === "scalp"
        ? [ob.bullish, ob.bullish - avgRange * 0.2, ob.bullish - avgRange * 0.4]
        : [ob.bullish, ob.bullish - avgRange * 0.35, ob.bullish - avgRange * 0.7];
    const allocations = [50, 30, 20];

    for (let i = 0; i < ladderEntries.length; i += 1) {
      const limitEntry = ladderEntries[i];
      const limitSl = Math.min(swings.low, ladderEntries[2] - avgRange * Math.max(1, stopMult));
      const limitTp = limitEntry + (limitEntry - limitSl) * tpMult;
      futureEntries.push({
        orderType: "BUY_LIMIT",
        entry: round(limitEntry),
        stopLoss: round(limitSl),
        takeProfit: round(limitTp),
        rr: round(Math.abs((limitTp - limitEntry) / (limitEntry - limitSl || 1)), 2),
        allocationPercent: allocations[i],
        expectedHold: holdText,
        rationale: `Limit layer ${i + 1} in bullish discount zone`
      });
    }
  } else if (direction === "SELL") {
    entry = (latest.close + ob.bearish) / 2;
    stopLoss = Math.max(swings.high, entry + avgRange * stopMult);
    takeProfit = entry - (stopLoss - entry) * tpMult;
    reasons.push("Bearish structure detected with lower highs and lower lows");
    reasons.push("Displacement supports continuation and validates sell-side pressure");
    const ladderEntries =
      appliedMode === "scalp"
        ? [ob.bearish, ob.bearish + avgRange * 0.2, ob.bearish + avgRange * 0.4]
        : [ob.bearish, ob.bearish + avgRange * 0.35, ob.bearish + avgRange * 0.7];
    const allocations = [50, 30, 20];

    for (let i = 0; i < ladderEntries.length; i += 1) {
      const limitEntry = ladderEntries[i];
      const limitSl = Math.max(swings.high, ladderEntries[2] + avgRange * Math.max(1, stopMult));
      const limitTp = limitEntry - (limitSl - limitEntry) * tpMult;
      futureEntries.push({
        orderType: "SELL_LIMIT",
        entry: round(limitEntry),
        stopLoss: round(limitSl),
        takeProfit: round(limitTp),
        rr: round(Math.abs((limitTp - limitEntry) / (limitSl - limitEntry || 1)), 2),
        allocationPercent: allocations[i],
        expectedHold: holdText,
        rationale: `Limit layer ${i + 1} in bearish premium zone`
      });
    }
  } else {
    stopLoss = direction === "NEUTRAL" ? latest.low - avgRange : latest.low;
    takeProfit = latest.high + avgRange;
    reasons.push("Structure is mixed; no directional edge from current sequence");
  }

  const rrRaw = Math.abs((takeProfit - entry) / (entry - stopLoss || 1));
  const confidenceBase = direction === "NEUTRAL" ? 0.45 : 0.62;
  const confidenceBoost = (crtExpansion ? 0.12 : 0) + (rangeCompression ? 0.08 : 0);
  const confidence = Math.min(0.92, confidenceBase + confidenceBoost);
  const rr = round(rrRaw, 2);

 const minQuality = process.env.AUTO_EXECUTION_MIN_QUALITY ?? "PERFECT";

const allowed =
(
    minQuality === "LOW" ||
    (minQuality === "MEDIUM" &&
        ["MEDIUM","HIGH","PERFECT"].includes(setup.signalQuality)) ||
    (minQuality === "HIGH" &&
        ["HIGH","PERFECT"].includes(setup.signalQuality)) ||
    (minQuality === "PERFECT" &&
        setup.signalQuality === "PERFECT")
);

if (
    allowed &&
    setup.direction !== "NEUTRAL" &&
    !executedSignalKeys.has(signalKey)
)
console.log({
    confidence,
    rr,
    futureEntries: futureEntries.length,
    signalQuality
});
  return {
    appliedMode,
    direction,
    entry: round(entry),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    rr,
    confidence: round(confidence, 2),
    signalQuality,
    reasons,
    futureEntries
  };
};
