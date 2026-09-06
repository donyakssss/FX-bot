import ccxt from "ccxt";
import crypto from "node:crypto";
import type { ExecutionPreferences } from "../types/contracts.js";
import type { SignalPayload } from "../types/journal.js";
import { enqueueMt5Order, listAllMt5Orders, type Mt5QueuedOrder } from "./mt5Bridge.js";
import { sendAlert } from "../notify/alert.js";
import { getRuntimeConfig } from "../runtime/config.js";

type BrokerType = "paper" | "binance" | "mt5";

type ExecutionResult = {
  executed: boolean;
  broker: BrokerType;
  message: string;
  details?: any;
};

type Mt5OrderType = "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP" | "BUY_MARKET" | "SELL_MARKET";

const broker = (process.env.BROKER ?? "paper") as BrokerType;
const autoEnabled = process.env.ENABLE_AUTO_EXECUTION === "true";
const oneTapEntryDefault = process.env.ONE_TAP_ENTRY_DEFAULT !== "false";
const enableTrailingDefault = process.env.ENABLE_TRAILING_DEFAULT !== "false";
const moveSlToBreakevenDefault = process.env.MOVE_SL_TO_BREAKEVEN_DEFAULT !== "false";

const mt5Prefix = process.env.MT5_SYMBOL_PREFIX ?? "";
const mt5Suffix = process.env.MT5_SYMBOL_SUFFIX ?? "";

const normalizeCryptoSymbolForMt5 = (symbol: string): string => {
  const upper = symbol.toUpperCase();
  if (upper.endsWith("USDT") || upper.endsWith("USDC") || upper.endsWith("BUSD")) {
    return `${upper.slice(0, -4)}USD`;
  }
  return upper;
};

const parseSymbolMap = (): Record<string, string> => {
  try {
    const raw = process.env.MT5_SYMBOL_MAP_JSON;
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
};

const mt5SymbolMap = parseSymbolMap();

export const isAutoExecutionEnabled = (): boolean => autoEnabled || getRuntimeConfig().enableAutoExecution;

const mapSymbolForMt5 = (symbol: string): string => {
  if (mt5SymbolMap[symbol]) {
    return mt5SymbolMap[symbol];
  }

  const normalized = normalizeCryptoSymbolForMt5(symbol);

  if (mt5Prefix.length > 0 || mt5Suffix.length > 0) {
    return `${mt5Prefix}${normalized}${mt5Suffix}`;
  }

  return normalized;
};

const trailingByMode = (mode: SignalPayload["setup"]["appliedMode"]) => {
  if (mode === "scalp") {
    return { breakEvenR: 1.0, trailStartR: 1.4, trailStepR: 0.75 };
  }
  if (mode === "day") {
    return { breakEvenR: 1.15, trailStartR: 1.8, trailStepR: 1.0 };
  }
  if (mode === "position") {
    return { breakEvenR: 1.6, trailStartR: 2.6, trailStepR: 1.4 };
  }
  return { breakEvenR: 1.35, trailStartR: 2.1, trailStepR: 1.2 };
};

const normalizeExecutionPrefs = (prefs?: ExecutionPreferences): Required<ExecutionPreferences> & { dryRun: boolean } => ({
  oneTapEntry: prefs?.oneTapEntry ?? oneTapEntryDefault,
  enableTrailing: prefs?.enableTrailing ?? enableTrailingDefault,
  moveSlToBreakeven: prefs?.moveSlToBreakeven ?? moveSlToBreakevenDefault,
  significantShiftOnly: prefs?.significantShiftOnly ?? true,
  dryRun: prefs?.dryRun ?? false
});

const signalHash = (payload: SignalPayload, orderType: Mt5OrderType, entry: number): string => {
  const basis = [
    payload.snapshot.market,
    payload.snapshot.symbol,
    payload.snapshot.timeframe,
    payload.setup.appliedMode,
    payload.setup.direction,
    orderType,
    entry.toFixed(5),
    payload.setup.stopLoss.toFixed(5),
    payload.setup.takeProfit.toFixed(5)
  ].join("|");

  return crypto.createHash("sha256").update(basis).digest("hex");
};

const executePaper = async (payload: SignalPayload): Promise<ExecutionResult> => {
  return {
    executed: true,
    broker: "paper",
    message: `Paper order simulated for ${payload.snapshot.symbol} (${payload.setup.direction})`
  };
};

const toBinanceSymbol = (symbol: string): string => symbol.replace("/", "");

const executeBinance = async (payload: SignalPayload): Promise<ExecutionResult> => {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !secret) {
    return {
      executed: false,
      broker: "binance",
      message: "Missing BINANCE_API_KEY or BINANCE_API_SECRET"
    };
  }

  const exchange = new ccxt.binance({
    apiKey,
    secret,
    enableRateLimit: true,
    options: { defaultType: "spot" }
  });

  const side = payload.setup.direction === "BUY" ? "buy" : "sell";
  const size = Math.max(0.001, payload.risk.lotSize / 10);
  const symbol = toBinanceSymbol(payload.snapshot.symbol);

  await exchange.createOrder(symbol, "market", side, size);
  return {
    executed: true,
    broker: "binance",
    message: `Binance market order sent for ${symbol}, side ${side}, size ${size}`
  };
};

const executeMt5 = async (payload: SignalPayload, prefs: Required<ExecutionPreferences>): Promise<ExecutionResult> => {
  if (
    payload.snapshot.market !== "forex" &&
    payload.snapshot.market !== "metals" &&
    payload.snapshot.market !== "indices" &&
    payload.snapshot.market !== "crypto"
  ) {
    return {
      executed: false,
      broker: "mt5",
      message: `MT5 bridge supports forex/metals/indices/crypto only. Received ${payload.snapshot.market}.`
    };
  }

  const brokerSymbol = mapSymbolForMt5(payload.snapshot.symbol);
  const trailingProfile = trailingByMode(payload.setup.appliedMode);
  const trailing = {
    breakEvenR: prefs.enableTrailing && prefs.moveSlToBreakeven ? trailingProfile.breakEvenR : 0,
    trailStartR: prefs.enableTrailing ? trailingProfile.trailStartR : 0,
    trailStepR: prefs.enableTrailing ? trailingProfile.trailStepR : 0
  };

  // one-tap market order
  if (prefs.oneTapEntry) {
    const entryPrice = payload.snapshot.candles[payload.snapshot.candles.length - 1].close;
    const orderType: Mt5OrderType = payload.setup.direction === "BUY" ? "BUY_MARKET" : "SELL_MARKET";
    const hash = signalHash(payload, orderType, entryPrice);
    const orderId = crypto.randomUUID();
    const order: Mt5QueuedOrder = {
      id: orderId,
      signalHash: hash,
      symbol: payload.snapshot.symbol,
      brokerSymbol,
      tradeMode: payload.setup.appliedMode,
      direction: (payload.setup.direction === "BUY" ? "BUY" : "SELL") as "BUY" | "SELL",
      orderType,
      entry: entryPrice,
      stopLoss: payload.setup.stopLoss,
      takeProfit: payload.setup.takeProfit,
      lotSize: Math.max(0.01, Number(payload.risk.lotSize.toFixed(2))),
      trailing,
      createdAt: new Date().toISOString(),
      status: "PENDING"
    };

    if (prefs.dryRun) {
      return { executed: false, broker: "mt5", message: "Dry-run: simulated one-tap market order", details: order };
    }

    const queued = enqueueMt5Order(order);
    if (queued.status === "REJECTED") {
      void sendAlert({ title: "MT5 Enqueue Rejected", text: `One-tap order for ${payload.snapshot.symbol} rejected: ${queued.note}`, meta: queued });
    }

    return {
      executed: queued.id === orderId,
      broker: "mt5",
      message: queued.id === orderId ? `MT5 order queued for ${payload.snapshot.symbol} -> ${brokerSymbol} (one-tap)` : `MT5 duplicate prevented for ${payload.snapshot.symbol}`
    };
  }

  // layered orders (limit/stop) from futureEntries
  const plans = payload.setup.futureEntries;
  if (!plans || plans.length === 0) {
    return { executed: false, broker: "mt5", message: "No future entries available for queuing." };
  }

  const simulated: Mt5QueuedOrder[] = [];
  const queuedResults: Mt5QueuedOrder[] = [];

  for (const plan of plans) {
    const orderType = plan.orderType as Mt5OrderType;
    const entryPrice = plan.entry;
    const orderId = crypto.randomUUID();
    const allocationLot = Math.max(0.01, Number((payload.risk.lotSize * (plan.allocationPercent / 100)).toFixed(2)));
    const order: Mt5QueuedOrder = {
      id: orderId,
      signalHash: signalHash(payload, orderType, entryPrice),
      symbol: payload.snapshot.symbol,
      brokerSymbol,
      tradeMode: payload.setup.appliedMode,
      direction: (payload.setup.direction === "BUY" ? "BUY" : "SELL") as "BUY" | "SELL",
      orderType,
      entry: entryPrice,
      stopLoss: plan.stopLoss,
      takeProfit: plan.takeProfit,
      lotSize: allocationLot,
      trailing,
      createdAt: new Date().toISOString(),
      status: "PENDING"
    };

    if (prefs.dryRun) {
      simulated.push(order);
      continue;
    }

    const queued = enqueueMt5Order(order);
    queuedResults.push(queued);
    if (queued.status === "REJECTED") {
      void sendAlert({ title: "MT5 Enqueue Rejected", text: `Queued layer order for ${payload.snapshot.symbol} rejected: ${queued.note}`, meta: queued });
    }
  }

  if (prefs.dryRun) {
    return { executed: false, broker: "mt5", message: `Dry-run: simulated ${simulated.length} queued orders`, details: simulated };
  }

  return { executed: queuedResults.length > 0, broker: "mt5", message: `Queued ${queuedResults.length} MT5 orders`, details: queuedResults };
};

export const executeSignalOrder = async (
  payload: SignalPayload,
  prefs?: ExecutionPreferences
): Promise<ExecutionResult> => {
  if (!isAutoExecutionEnabled()) {
    return {
      executed: false,
      broker,
      message: "Auto execution is disabled. Set ENABLE_AUTO_EXECUTION=true to enable."
    };
  }

  const executionPrefs = normalizeExecutionPrefs(prefs);

  if (executionPrefs.significantShiftOnly && !payload.setup.marketShift.significant) {
    return {
      executed: false,
      broker,
      message: "Execution skipped: no significant market shift yet."
    };
  }

  if (broker === "binance") {
    return executeBinance(payload);
  }

  if (broker === "mt5") {
    return executeMt5(payload, executionPrefs);
  }

  return executePaper(payload);
};