import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";
import type { JournalStats, SignalPayload, TradeRecord } from "../types/journal.js";

const dataDir = join(process.cwd(), "data");
const filePath = join(dataDir, "trades.json");

const ensureStore = (): void => {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "[]", "utf8");
  }
};

const load = (): TradeRecord[] => {
  ensureStore();
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as TradeRecord[];
};

const save = (trades: TradeRecord[]): void => {
  ensureStore();
  writeFileSync(filePath, JSON.stringify(trades, null, 2), "utf8");
};

const toRound = (n: number, d = 2): number => Number(n.toFixed(d));

export const listTrades = (): TradeRecord[] => load().sort((a, b) => b.openedAt.localeCompare(a.openedAt));

export const getStats = (): JournalStats => {
  const trades = load();
  const total = trades.length;
  const open = trades.filter((t) => t.status === "OPEN").length;
  const won = trades.filter((t) => t.status === "WON").length;
  const lost = trades.filter((t) => t.status === "LOST").length;
  const closed = trades.filter((t) => t.status !== "OPEN");
  const totalPnl = closed.reduce((acc, t) => acc + (t.pnlAmount ?? 0), 0);
  const avgR = closed.length > 0 ? closed.reduce((acc, t) => acc + (t.pnlR ?? 0), 0) / closed.length : 0;

  return {
    total,
    open,
    won,
    lost,
    winRate: won + lost > 0 ? toRound((won / (won + lost)) * 100, 2) : 0,
    totalPnl: toRound(totalPnl, 2),
    averageR: toRound(avgR, 2)
  };
};

export const recordSignalTrade = (payload: SignalPayload, source: "signal" | "auto-execution" = "signal"): TradeRecord | null => {
  if (payload.setup.direction === "NEUTRAL") {
    return null;
  }

  const trades = load();
  const existingOpen = trades.find(
    (t) =>
      t.status === "OPEN" &&
      t.symbol === payload.snapshot.symbol &&
      t.timeframe === payload.snapshot.timeframe &&
      t.tradeMode === payload.setup.appliedMode
  );

  if (existingOpen) {
    return existingOpen;
  }

  const trade: TradeRecord = {
    id: crypto.randomUUID(),
    market: payload.snapshot.market,
    symbol: payload.snapshot.symbol,
    timeframe: payload.snapshot.timeframe,
    tradeMode: payload.setup.appliedMode,
    direction: payload.setup.direction,
    signalQuality: payload.setup.signalQuality,
    entry: payload.setup.entry,
    stopLoss: payload.setup.stopLoss,
    takeProfit: payload.setup.takeProfit,
    riskAmount: payload.risk.riskAmount,
    lotSize: payload.risk.lotSize,
    openedAt: new Date().toISOString(),
    status: "OPEN",
    source
  };

  trades.push(trade);
  save(trades);
  return trade;
};

export const resolveOpenTrades = (payload: SignalPayload): TradeRecord[] => {
  const trades = load();
  const latest = payload.snapshot.candles[payload.snapshot.candles.length - 1];
  const updated: TradeRecord[] = [];

  for (const trade of trades) {
    if (
      trade.status !== "OPEN" ||
      trade.symbol !== payload.snapshot.symbol ||
      trade.timeframe !== payload.snapshot.timeframe
    ) {
      continue;
    }

    if (trade.direction === "BUY") {
      if (latest.low <= trade.stopLoss) {
        trade.status = "LOST";
        trade.closedAt = new Date().toISOString();
        trade.closePrice = trade.stopLoss;
        trade.pnlAmount = toRound(-trade.riskAmount, 2);
        trade.pnlR = -1;
      } else if (latest.high >= trade.takeProfit) {
        const rr = Math.abs((trade.takeProfit - trade.entry) / (trade.entry - trade.stopLoss || 1));
        trade.status = "WON";
        trade.closedAt = new Date().toISOString();
        trade.closePrice = trade.takeProfit;
        trade.pnlAmount = toRound(trade.riskAmount * rr, 2);
        trade.pnlR = toRound(rr, 2);
      }
    }

    if (trade.direction === "SELL") {
      if (latest.high >= trade.stopLoss) {
        trade.status = "LOST";
        trade.closedAt = new Date().toISOString();
        trade.closePrice = trade.stopLoss;
        trade.pnlAmount = toRound(-trade.riskAmount, 2);
        trade.pnlR = -1;
      } else if (latest.low <= trade.takeProfit) {
        const rr = Math.abs((trade.entry - trade.takeProfit) / (trade.stopLoss - trade.entry || 1));
        trade.status = "WON";
        trade.closedAt = new Date().toISOString();
        trade.closePrice = trade.takeProfit;
        trade.pnlAmount = toRound(trade.riskAmount * rr, 2);
        trade.pnlR = toRound(rr, 2);
      }
    }

    updated.push(trade);
  }

  save(trades);
  return updated;
};

export const resetJournal = (): void => save([]);
