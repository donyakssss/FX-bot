import type { AnalyzeRequest, Candle, FutureEntry, MarketShiftAssessment, SignalQuality, TradeDirection, TradeMode, TradeSetup } from "../types/contracts.js";

const round = (v: number, d = 5) => Number(v.toFixed(d));

const avg = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
const getRange = (c: Candle) => Math.abs(c.high - c.low);

const findLocalExtrema = (candles: Candle[], window = 12) => {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const center = candles[i];
    const isHigh = candles.slice(i - window, i + window + 1).every((c) => center.high >= c.high);
    const isLow = candles.slice(i - window, i + window + 1).every((c) => center.low <= c.low);
    if (isHigh) highs.push(center.high);
    if (isLow) lows.push(center.low);
  }
  return { highs, lows };
};

const clusterLevels = (levels: number[], tolerancePct = 0.0025) => {
  if (levels.length === 0) return [] as number[];
  const sorted = Array.from(new Set(levels)).sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const lv of sorted) {
    const assigned = clusters.find((c) => Math.abs(c[0] - lv) / Math.max(1, Math.abs(c[0])) <= tolerancePct);
    if (assigned) assigned.push(lv);
    else clusters.push([lv]);
  }
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
};

const detectDirection = (candles: Candle[]) => {
  const recent = candles.slice(-14);
  const high = recent[recent.length - 1].high - recent[0].high;
  const low = recent[recent.length - 1].low - recent[0].low;
  if (high > Math.abs(low)) return "BUY" as TradeDirection;
  if (Math.abs(low) > Math.abs(high)) return "SELL" as TradeDirection;
  return "NEUTRAL" as TradeDirection;
};

const assessBreakout = (candles: Candle[], level: number, side: "UP" | "DOWN") => {
  const latest = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recentRange = avg(candles.slice(-8).map(getRange)) || 1;
  if (side === "UP") {
    const broke = latest.close > level && prev.close <= level;
    const strength = (latest.close - level) / recentRange;
    return { broke, strength };
  }
  const broke = latest.close < level && prev.close >= level;
  const strength = (level - latest.close) / recentRange;
  return { broke, strength };
};

const evaluateMarketShift = (candles: Candle[], avgRange: number, mode: TradeMode, direction: TradeDirection): MarketShiftAssessment => {
  const latest = candles[candles.length - 1];
  const displacement = Math.abs(latest.close - candles[candles.length - 3].close) / Math.max(1, avgRange);
  const score = Math.min(2, displacement * (mode === "scalp" ? 0.9 : mode === "day" ? 1.0 : 1.25));
  const significant = score > 0.9 && direction !== "NEUTRAL";
  const reasons: string[] = [];
  if (significant) reasons.push("Breakout/expansion detected relative to recent range");
  else reasons.push("No strong regime shift; leaning on S/R confluence");
  return {
    significant,
    score: Number(score.toFixed(2)),
    displacementRatio: Number(displacement.toFixed(2)),
    trendStrength: Number(Math.min(2, Math.abs(latest.close - candles[candles.length - 8].close) / Math.max(1, avgRange)).toFixed(2)),
    volatilityExpansion: Number((avgRange / Math.max(1, avg(candles.slice(-16).map(getRange)))).toFixed(2)),
    reasons
  };
};

export const analyzeSetup = (request: AnalyzeRequest): TradeSetup => {
  const candles = request.candles;
  const latest = candles[candles.length - 1];
  const appliedMode: TradeMode = request.tradeMode ?? (request.timeframe === "H4" || request.timeframe === "D1" ? "swing" : "day");
  const modeWindow = appliedMode === "position" ? 80 : appliedMode === "swing" ? 60 : appliedMode === "day" ? 30 : 14;

  const windowSlice = candles.slice(-Math.max(40, modeWindow));
  const avgRange = avg(windowSlice.map(getRange)) || Math.max(0.0001, Math.abs(latest.close * 0.0005));

  // detect local swing highs/lows and cluster them into S/R zones
  const extrema = findLocalExtrema(windowSlice, 6);
  const srHighs = clusterLevels(extrema.highs, 0.0025);
  const srLows = clusterLevels(extrema.lows, 0.0025);

  // choose strongest S and R
  const resistance = srHighs.length > 0 ? srHighs[srHighs.length - 1] : Math.max(...windowSlice.map((c) => c.high));
  const support = srLows.length > 0 ? srLows[0] : Math.min(...windowSlice.map((c) => c.low));

  const direction = detectDirection(candles);
  const marketShift = evaluateMarketShift(candles, avgRange, appliedMode, direction);

  const reasons: string[] = [];
  reasons.push(`Identified support ${support.toFixed(5)} and resistance ${resistance.toFixed(5)}`);
  if (marketShift.significant) reasons.push("Momentum expansion favors breakout entries");

  // Primary entry logic: breakout market order or limit retrace entries
  const futureEntries: FutureEntry[] = [];

  const breakoutUp = assessBreakout(candles, resistance, "UP");
  const breakoutDown = assessBreakout(candles, support, "DOWN");

  // multiple allocations: up to 3 layers
  const allocations = [50, 30, 20];

  if (breakoutUp.broke || (direction === "BUY" && latest.close > resistance - avgRange * 0.15)) {
    // valid buy scenario
    const baseEntryMarket = breakoutUp.broke ? latest.close : Math.min(latest.close, resistance + avgRange * 0.05);
    const baseStop = Math.max(support, baseEntryMarket - avgRange * (appliedMode === "scalp" ? 1.0 : 1.6));
    const baseTp = baseEntryMarket + (baseEntryMarket - baseStop) * (appliedMode === "scalp" ? 1.6 : 2.6);

    // market immediate
    futureEntries.push({
      orderType: "BUY_STOP",
      entry: round(baseEntryMarket),
      stopLoss: round(baseStop),
      takeProfit: round(baseTp),
      rr: round(Math.abs((baseTp - baseEntryMarket) / (baseEntryMarket - baseStop || 1)), 2),
      allocationPercent: allocations[0],
      expectedHold: appliedMode === "scalp" ? "minutes-hours" : "hours-days",
      rationale: "Breakout confirmed; use immediate entry with tight stop near support"
    });

    // retrace limit layers
    for (let i = 1; i < 3; i++) {
      const entry = resistance - avgRange * 0.25 * i;
      const stop = Math.max(support, entry - avgRange * (1.4 + i * 0.2));
      const tp = entry + (entry - stop) * (appliedMode === "scalp" ? 1.6 : 2.6);
      futureEntries.push({
        orderType: entry <= latest.close ? "BUY_LIMIT" : "BUY_STOP",
        entry: round(entry),
        stopLoss: round(stop),
        takeProfit: round(tp),
        rr: round(Math.abs((tp - entry) / (entry - stop || 1)), 2),
        allocationPercent: allocations[i],
        expectedHold: appliedMode === "scalp" ? "minutes-hours" : "hours-days",
        rationale: `Retrace layer ${i}`
      });
    }
  } else if (breakoutDown.broke || (direction === "SELL" && latest.close < support + avgRange * 0.15)) {
    // valid sell scenario
    const baseEntryMarket = breakoutDown.broke ? latest.close : Math.max(latest.close, support - avgRange * 0.05);
    const baseStop = Math.min(resistance, baseEntryMarket + avgRange * (appliedMode === "scalp" ? 1.0 : 1.6));
    const baseTp = baseEntryMarket - (baseStop - baseEntryMarket) * (appliedMode === "scalp" ? 1.6 : 2.6);

    futureEntries.push({
      orderType: "SELL_STOP",
      entry: round(baseEntryMarket),
      stopLoss: round(baseStop),
      takeProfit: round(baseTp),
      rr: round(Math.abs((baseEntryMarket - baseTp) / (baseStop - baseEntryMarket || 1)), 2),
      allocationPercent: allocations[0],
      expectedHold: appliedMode === "scalp" ? "minutes-hours" : "hours-days",
      rationale: "Breakdown confirmed; use immediate entry with tight stop near resistance"
    });

    for (let i = 1; i < 3; i++) {
      const entry = support + avgRange * 0.25 * i;
      const stop = Math.min(resistance, entry + avgRange * (1.4 + i * 0.2));
      const tp = entry - (stop - entry) * (appliedMode === "scalp" ? 1.6 : 2.6);
      futureEntries.push({
        orderType: entry >= latest.close ? "SELL_LIMIT" : "SELL_STOP",
        entry: round(entry),
        stopLoss: round(stop),
        takeProfit: round(tp),
        rr: round(Math.abs((entry - tp) / (stop - entry || 1)), 2),
        allocationPercent: allocations[i],
        expectedHold: appliedMode === "scalp" ? "minutes-hours" : "hours-days",
        rationale: `Retrace layer ${i}`
      });
    }
  } else {
    // no clear edge
    reasons.push("No clear breakout or retrace edge; awaiting a cleaner setup");
  }

  // confidence scoring
  const confidence = Math.min(0.97, Math.max(0.35, marketShift.significant ? 0.75 + marketShift.score * 0.12 : 0.42));

  const entry = futureEntries.length > 0 ? futureEntries[0].entry : latest.close;
  const stopLoss = futureEntries.length > 0 ? futureEntries[0].stopLoss : latest.low - avgRange;
  const takeProfit = futureEntries.length > 0 ? futureEntries[0].takeProfit : latest.high + avgRange;
  const rr = round(Math.abs((takeProfit - entry) / (entry - stopLoss || 1)), 2);

  const signalQuality: SignalQuality =
    futureEntries.length >= 3 && confidence >= 0.8 && marketShift.significant && rr >= 1.5
      ? "PERFECT"
      : confidence >= 0.72 && rr >= 1.2
      ? "HIGH"
      : confidence >= 0.6
      ? "MEDIUM"
      : "LOW";

  const strategyVersion = `malaysian-snr-${appliedMode}-${new Date().toISOString().slice(0, 10)}`;

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
    futureEntries,
    annotations: [
      { type: "SUPPORT", price: round(support), label: "Support" },
      { type: "RESISTANCE", price: round(resistance), label: "Resistance" },
      { type: "ENTRY", price: round(entry), label: "Primary Entry" },
      { type: "SL", price: round(stopLoss), label: "Stop Loss" },
      { type: "TP", price: round(takeProfit), label: "Take Profit" }
    ]
  };
};
