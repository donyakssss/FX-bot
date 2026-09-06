import type {
  AnalyzeRequest,
  Candle,
  FutureEntry,
  MarketShiftAssessment,
  SignalQuality,
  TradeDirection,
  TradeMode,
  TradeSetup
} from "../types/contracts.js";

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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const evaluateMarketShift = (
  candles: Candle[],
  avgRange: number,
  mode: TradeMode,
  direction: TradeDirection
): MarketShiftAssessment => {
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const ranges = candles.slice(-12).map(getRange);
  const recentRange = avg(ranges.slice(-6));
  const previousRange = avg(ranges.slice(0, 6));

  const displacementRatio = Math.abs(latest.close - previous.close) / Math.max(avgRange, Number.EPSILON);
  const trendStrengthRaw = Math.abs(latest.close - candles[candles.length - 12].close) / Math.max(avgRange * 3, Number.EPSILON);
  const trendStrength = clamp(trendStrengthRaw, 0, 2);
  const volatilityExpansion = previousRange > 0 ? recentRange / previousRange : 1;

  const modeBias = mode === "scalp" ? 0.95 : mode === "day" ? 1.0 : mode === "swing" ? 1.08 : 1.15;
  const scoreRaw = displacementRatio * 0.5 + trendStrength * 0.3 + Math.max(0, volatilityExpansion - 1) * 0.2;
  const score = Number((scoreRaw * modeBias).toFixed(2));
  const significant = direction !== "NEUTRAL" && displacementRatio >= 0.8 && score >= 1.05;

  const reasons: string[] = [];
  if (displacementRatio >= 0.8) {
    reasons.push("Strong displacement from the prior close");
  }
  if (volatilityExpansion >= 1.12) {
    reasons.push("Volatility expansion confirms regime change");
  }
  if (trendStrength >= 0.95) {
    reasons.push("Directional momentum strengthened across recent candles");
  }
  if (reasons.length === 0) {
    reasons.push("No structural expansion yet; waiting for clearer market shift");
  }

  return {
    significant,
    score,
    displacementRatio: Number(displacementRatio.toFixed(2)),
    trendStrength: Number(trendStrength.toFixed(2)),
    volatilityExpansion: Number(volatilityExpansion.toFixed(2)),
    reasons
  };
};

export const analyzeSetup = (request: AnalyzeRequest): TradeSetup => {
  const candles = request.candles;
  const latest = candles[candles.length - 1];
  const inferredMode: TradeMode = request.timeframe === "H4" || request.timeframe === "D1" ? "swing" : "day";
  const appliedMode = request.tradeMode ?? inferredMode;
  const isLongTerm = appliedMode === "swing" || appliedMode === "position";
  const scalpMode = appliedMode === "scalp";
  const modeWindow = appliedMode === "position" ? 70 : appliedMode === "swing" ? 60 : appliedMode === "day" ? 30 : 16;
  const stopMult = appliedMode === "position" ? 1.8 : appliedMode === "swing" ? 1.5 : appliedMode === "day" ? 1.1 : 0.45;
  const tpMult = appliedMode === "position" ? 3.8 : appliedMode === "swing" ? 3.2 : appliedMode === "day" ? 2.2 : 1.1;
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
  const scalpRange = Math.max(avgRange * 0.25, latest.close * 0.00035);

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
  const marketShift = evaluateMarketShift(candles, avgRange, appliedMode, direction);

  const reasons: string[] = [];
  if (crtExpansion) reasons.push("CRT expansion detected (strong displacement candle)");
  if (rangeCompression) reasons.push("CRT range shift indicates momentum transition");
  reasons.push(`Mode: ${appliedMode.toUpperCase()} analysis profile active`);
  reasons.push(
    marketShift.significant
      ? `Significant shift confirmed (score ${marketShift.score})`
      : `Shift not yet significant (score ${marketShift.score}); patience favored`
  );

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
      scalpMode
        ? [latest.close - scalpRange * 0.15, latest.close - scalpRange * 0.3, latest.close - scalpRange * 0.45]
        : [ob.bullish, ob.bullish - avgRange * 0.35, ob.bullish - avgRange * 0.7];
    const allocations = scalpMode ? [40, 35, 25] : [50, 30, 20];

    for (let i = 0; i < ladderEntries.length; i += 1) {
      const limitEntry = ladderEntries[i];
      const limitSl = scalpMode
        ? limitEntry - Math.max(avgRange * 0.5, latest.close * 0.001)
        : Math.min(swings.low, ladderEntries[2] - avgRange * Math.max(1, stopMult));
      const limitTp = limitEntry + (limitEntry - limitSl) * tpMult;
      futureEntries.push({
        orderType: limitEntry <= latest.close ? "BUY_LIMIT" : "BUY_STOP",
        entry: round(limitEntry),
        stopLoss: round(limitSl),
        takeProfit: round(limitTp),
        rr: round(Math.abs((limitTp - limitEntry) / (limitEntry - limitSl || 1)), 2),
        allocationPercent: allocations[i],
        expectedHold: holdText,
        rationale: scalpMode ? `Close scalp layer ${i + 1} near current price` : `Limit layer ${i + 1} in bullish discount zone`
      });
    }
  } else if (direction === "SELL") {
    entry = (latest.close + ob.bearish) / 2;
    stopLoss = Math.max(swings.high, entry + avgRange * stopMult);
    takeProfit = entry - (stopLoss - entry) * tpMult;
    reasons.push("Bearish structure detected with lower highs and lower lows");
    reasons.push("Displacement supports continuation and validates sell-side pressure");
    const ladderEntries =
      scalpMode
        ? [latest.close + scalpRange * 0.15, latest.close + scalpRange * 0.3, latest.close + scalpRange * 0.45]
        : [ob.bearish, ob.bearish + avgRange * 0.35, ob.bearish + avgRange * 0.7];
    const allocations = scalpMode ? [40, 35, 25] : [50, 30, 20];

    for (let i = 0; i < ladderEntries.length; i += 1) {
      const limitEntry = ladderEntries[i];
      const limitSl = scalpMode
        ? limitEntry + Math.max(avgRange * 0.5, latest.close * 0.001)
        : Math.max(swings.high, ladderEntries[2] + avgRange * Math.max(1, stopMult));
      const limitTp = limitEntry - (limitSl - limitEntry) * tpMult;
      futureEntries.push({
        orderType: limitEntry >= latest.close ? "SELL_LIMIT" : "SELL_STOP",
        entry: round(limitEntry),
        stopLoss: round(limitSl),
        takeProfit: round(limitTp),
        rr: round(Math.abs((limitTp - limitEntry) / (limitSl - limitEntry || 1)), 2),
        allocationPercent: allocations[i],
        expectedHold: holdText,
        rationale: scalpMode ? `Close scalp layer ${i + 1} near current price` : `Limit layer ${i + 1} in bearish premium zone`
      });
    }
  } else {
    stopLoss = direction === "NEUTRAL" ? latest.low - avgRange : latest.low;
    takeProfit = latest.high + avgRange;
    reasons.push("Structure is mixed; no directional edge from current sequence");
  }

  const rrRaw = Math.abs((takeProfit - entry) / (entry - stopLoss || 1));
  const confidenceBase = direction === "NEUTRAL" ? 0.45 : scalpMode ? 0.68 : 0.62;
  const confidenceBoost =
    (crtExpansion ? 0.12 : 0) +
    (rangeCompression ? 0.08 : 0) +
    (marketShift.significant ? 0.1 : -0.06);

  const fundamentalDirectionalBias =
    request.fundamentals == null
      ? 0
      : request.fundamentals.sentimentScore * (direction === "BUY" ? 1 : direction === "SELL" ? -1 : 0);
  const fundamentalImpactWeight =
    request.fundamentals?.impact === "HIGH" ? 0.09 : request.fundamentals?.impact === "MEDIUM" ? 0.05 : 0.02;
  const fundamentalBoost = fundamentalDirectionalBias * fundamentalImpactWeight;

  const confidence = Math.min(0.95, Math.max(0.35, confidenceBase + confidenceBoost + fundamentalBoost));
  const rr = round(rrRaw, 2);
  const signalQuality: SignalQuality =
  direction !== "NEUTRAL" &&
  confidence >= 0.8 &&
  marketShift.significant &&
  rr >= (scalpMode ? 1.15 : 2.2) &&
  futureEntries.length >= 3
    ? "PERFECT"
    : direction !== "NEUTRAL" && confidence >= 0.72 && rr >= 1.8 && marketShift.score >= 0.95
      ? "HIGH"
      : direction !== "NEUTRAL" && confidence >= 0.62
        ? "MEDIUM"
        : "LOW";

  if (request.fundamentals) {
    reasons.push(
      `Fundamentals bias ${request.fundamentals.sentimentScore >= 0 ? "supports" : "opposes"} setup (${request.fundamentals.impact} impact)`
    );
  }

  const strategyVersion = `smc-crt-adaptive-${appliedMode}-${marketShift.significant ? "shift" : "range"}-${new Date().toISOString().slice(0, 10)}`;

return {
  appliedMode,
  direction,
  entry: round(entry),
  stopLoss: round(stopLoss),
  takeProfit: round(takeProfit),
  rr,
  confidence: round(confidence, 2),
  signalQuality,
  marketShift,
  fundamentals: request.fundamentals,
  strategyVersion,
  reasons,
  futureEntries
};
};