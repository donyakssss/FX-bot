import type { AnalyzeRequest, TradeSetup } from "../types/contracts.js";
import { analyzeSetup as smcAnalyze } from "./smcCrtStrategy.js";
import { analyzeSetup as malayAnalyze } from "./malaysianSnrStrategy.js";

export const analyzeSetup = (request: AnalyzeRequest): TradeSetup => {
  const preferred = (request.strategy ?? process.env.DEFAULT_STRATEGY ?? "smc-crt").toLowerCase();
  if (preferred.includes("malaysian") || preferred.includes("snr")) {
    return malayAnalyze(request);
  }
  return smcAnalyze(request);
};
