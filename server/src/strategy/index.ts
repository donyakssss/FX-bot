import type { AnalyzeRequest, TradeSetup } from "../types/contracts.js";
import { analyzeSetup as smcAnalyze } from "./smcCrtStrategy.js";
import { analyzeSetup as malayAnalyze } from "./malaysianSnrStrategy.js";

export const analyzeSetup = (request: AnalyzeRequest): TradeSetup => {
  // If caller explicitly requested a strategy, honour it
  const preferred = (request.strategy ?? process.env.DEFAULT_STRATEGY ?? "").toLowerCase();
  if (preferred.includes("malaysian") || preferred.includes("snr")) {
    return malayAnalyze(request);
  }
  if (preferred.includes("smc") || preferred.includes("crt")) {
    return smcAnalyze(request);
  }

  // No explicit preference: run both analyzers and pick the stronger signal.
  const s1 = smcAnalyze(request);
  const s2 = malayAnalyze(request);

  // prefer higher confidence, then higher RR, then signalQuality
  const score = (s: TradeSetup) => (s.confidence ?? 0) * 100 + (s.rr ?? 0) * 10 + (s.signalQuality === "PERFECT" ? 30 : s.signalQuality === "HIGH" ? 15 : s.signalQuality === "MEDIUM" ? 6 : 0);

  const s1Score = score(s1);
  const s2Score = score(s2);

  return s2Score >= s1Score ? s2 : s1;
};
