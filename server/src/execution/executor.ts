import ccxt from "ccxt";
import crypto from "node:crypto";
import type { SignalPayload } from "../types/journal.js";
import { enqueueMt5Order, type Mt5QueuedOrder } from "./mt5Bridge.js";

type BrokerType = "paper" | "binance" | "mt5";

type ExecutionResult = {
  executed: boolean;
  broker: BrokerType;
  message: string;
};

const broker = (process.env.BROKER ?? "paper") as BrokerType;
const autoEnabled = process.env.ENABLE_AUTO_EXECUTION === "true";

const mt5Prefix = process.env.MT5_SYMBOL_PREFIX ?? "";
const mt5Suffix = process.env.MT5_SYMBOL_SUFFIX ?? "";

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

export const isAutoExecutionEnabled = (): boolean => autoEnabled;

const mapSymbolForMt5 = (symbol: string): string => {
  if (mt5SymbolMap[symbol]) {
    return mt5SymbolMap[symbol];
  }
  return `${mt5Prefix}${symbol}${mt5Suffix}`;
};

const trailingByMode = (mode: SignalPayload["setup"]["appliedMode"]) => {
  if (mode === "scalp") {
    return { breakEvenR: 0.8, trailStartR: 1.2, trailStepR: 0.6 };
  }
  if (mode === "day") {
    return { breakEvenR: 1.0, trailStartR: 1.6, trailStepR: 0.9 };
  }
  if (mode === "position") {
    return { breakEvenR: 1.4, trailStartR: 2.2, trailStepR: 1.2 };
  }
  return { breakEvenR: 1.2, trailStartR: 1.8, trailStepR: 1.0 };
};

const signalHash = (payload: SignalPayload, orderType: "BUY_LIMIT" | "SELL_LIMIT", entry: number): string => {
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

const executeMt5 = async (payload: SignalPayload): Promise<ExecutionResult> => {
  if (payload.snapshot.market !== "forex" && payload.snapshot.market !== "metals" && payload.snapshot.market !== "indices") {
    return {
      executed: false,
      broker: "mt5",
      message: `MT5 bridge supports forex/metals/indices only. Received ${payload.snapshot.market}.`
    };
  }

  const primaryLimit = payload.setup.futureEntries[0];
  if (!primaryLimit) {
    return {
      executed: false,
      broker: "mt5",
      message: "No limit order plan available to queue for MT5."
    };
  }

  const brokerSymbol = mapSymbolForMt5(payload.snapshot.symbol);
  const trailing = trailingByMode(payload.setup.appliedMode);
  const hash = signalHash(payload, primaryLimit.orderType, primaryLimit.entry);

 const orderId = crypto.randomUUID();

const order: Mt5QueuedOrder = {
  id: orderId,
  signalHash: hash,
  symbol: payload.snapshot.symbol,
  brokerSymbol,
  tradeMode: payload.setup.appliedMode,
  direction: (payload.setup.direction === "BUY" ? "BUY" : "SELL") as "BUY" | "SELL",
  orderType: primaryLimit.orderType,
  entry: primaryLimit.entry,
  stopLoss: primaryLimit.stopLoss,
  takeProfit: primaryLimit.takeProfit,
  lotSize: Math.max(0.01, Number(payload.risk.lotSize.toFixed(2))),
  trailing,
  createdAt: new Date().toISOString(),
  status: "PENDING"
};

console.log("========== QUEUING MT5 ORDER ==========");
console.log(JSON.stringify(order, null, 2));

const queued = enqueueMt5Order(order);

console.log("Queued:", queued);
console.log("======================================");
  return {
    executed: queued.id === orderId,
    broker: "mt5",
    message:
      queued.id === orderId
        ? `MT5 order queued for ${payload.snapshot.symbol} -> ${brokerSymbol} (${primaryLimit.orderType})`
        : `MT5 duplicate prevented for ${payload.snapshot.symbol}`
  };
};

export const executeSignalOrder = async (payload: SignalPayload): Promise<ExecutionResult> => {
    console.log("ENTERED executeSignalOrder");
    console.log("Broker =", broker);
    console.log("Auto =", autoEnabled);
    console.log("Auto Enabled:", autoEnabled);
console.log("Broker:", broker);

    if (!autoEnabled) {
        console.log("AUTO DISABLED");
        return {
            executed: false,
            broker,
            message: "Auto execution is disabled. Set ENABLE_AUTO_EXECUTION=true to enable."
        };
    }

    console.log("Passed auto check");

    if (broker === "binance") {
        console.log("Executing Binance");
        return executeBinance(payload);
    }

    if (broker === "mt5") {
        console.log("Executing MT5");
        return executeMt5(payload);
    }

    console.log("Executing Paper");
    return executePaper(payload);
};