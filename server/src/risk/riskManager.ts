import type { PositionSizing } from "../types/contracts.js";

type PositionInput = {
  accountBalance: number;
  riskPercent: number;
  entry: number;
  stopLoss: number;
  pair: string;
  quoteCurrency: string;
};

const round = (v: number, digits = 2): number => Number(v.toFixed(digits));

const detectPipSize = (pair: string): number => (pair.includes("JPY") ? 0.01 : 0.0001);

const estimatePipValuePerStandardLot = (pair: string, quoteCurrency: string): number => {
  if (quoteCurrency === "USD") {
    return pair.includes("JPY") ? 9.1 : 10;
  }
  return 10;
};

export const validateRiskParams = (
  risk: PositionInput | { accountBalance: number; riskPercent: number }
): { valid: boolean; message?: string } => {
  if (risk.accountBalance <= 0) {
    return { valid: false, message: "Account balance must be greater than 0." };
  }
  if (risk.riskPercent <= 0 || risk.riskPercent > 5) {
    return { valid: false, message: "Risk percent must be between 0 and 5." };
  }
  return { valid: true };
};

export const computePositionSizing = (input: PositionInput): PositionSizing => {
  const riskAmount = input.accountBalance * (input.riskPercent / 100);
  const pipSize = detectPipSize(input.pair);
  const stopDistancePips = Math.abs(input.entry - input.stopLoss) / pipSize;
  const pipValue = estimatePipValuePerStandardLot(input.pair, input.quoteCurrency);

  const rawLotSize = stopDistancePips > 0 ? riskAmount / (stopDistancePips * pipValue) : 0;
  const lotSize = Math.max(0, Math.min(100, rawLotSize));

  const warnings: string[] = [];
  if (lotSize < 0.01) {
    warnings.push("Calculated lot size is below 0.01. Consider reducing stop distance or increasing account size.");
  }
  if (stopDistancePips < 5) {
    warnings.push("Stop distance is very tight (<5 pips); spread/slippage may impact this setup.");
  }
  if (stopDistancePips > 100) {
    warnings.push("Stop distance is wide (>100 pips); position may be too conservative for short timeframes.");
  }

  return {
    riskAmount: round(riskAmount, 2),
    stopDistancePips: round(stopDistancePips, 1),
    lotSize: round(lotSize, 2),
    warnings
  };
};
