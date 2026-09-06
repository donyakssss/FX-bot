import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Mt5OrderStatus = "PENDING" | "PROCESSING" | "FILLED" | "REJECTED";

export type Mt5TrailingRules = {
  breakEvenR: number;
  trailStartR: number;
  trailStepR: number;
};

export type Mt5QueuedOrder = {
  id: string;
  signalHash: string;
  symbol: string;
  brokerSymbol: string;
  tradeMode: "scalp" | "day" | "swing" | "position";
  direction: "BUY" | "SELL";
  orderType: "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP" | "BUY_MARKET" | "SELL_MARKET";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  trailing: Mt5TrailingRules;
  createdAt: string;
  status: Mt5OrderStatus;
  claimedAt?: string;
  claimOwner?: string;
  ticket?: string;
  note?: string;
};

const dataDir = join(process.cwd(), "data");
const filePath = join(dataDir, "mt5-orders.json");
const claimTtlMs = Number(process.env.MT5_ORDER_CLAIM_TTL_MS ?? 30000);

const cryptoRandomId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const normalizeSymbolKey = (value: string): string => value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const sameSymbol = (left: Mt5QueuedOrder, rightSymbol: string, rightBrokerSymbol?: string): boolean => {
  const leftSymbolKey = normalizeSymbolKey(left.symbol);
  const leftBrokerKey = normalizeSymbolKey(left.brokerSymbol);
  const rightSymbolKey = normalizeSymbolKey(rightSymbol);
  const rightBrokerKey = normalizeSymbolKey(rightBrokerSymbol ?? rightSymbol);

  return (
    leftSymbolKey === rightSymbolKey ||
    leftBrokerKey === rightBrokerKey ||
    leftSymbolKey === rightBrokerKey ||
    leftBrokerKey === rightSymbolKey
  );
};

const isChartSymbolMatch = (order: Mt5QueuedOrder, chartSymbol?: string): boolean => {
  if (!chartSymbol) {
    return true;
  }

  const chartKey = normalizeSymbolKey(chartSymbol);
  const brokerKey = normalizeSymbolKey(order.brokerSymbol);
  const baseKey = normalizeSymbolKey(order.symbol);

  if (!chartKey) {
    return true;
  }

  return (
    brokerKey === chartKey ||
    baseKey === chartKey ||
    brokerKey.includes(chartKey) ||
    chartKey.includes(brokerKey) ||
    baseKey.includes(chartKey) ||
    chartKey.includes(baseKey)
  );
};

const ensureStore = (): void => {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "[]", "utf8");
  }
};

const load = (): Mt5QueuedOrder[] => {
  ensureStore();
  return JSON.parse(readFileSync(filePath, "utf8")) as Mt5QueuedOrder[];
};

const save = (orders: Mt5QueuedOrder[]): void => {
  ensureStore();
  writeFileSync(filePath, JSON.stringify(orders, null, 2), "utf8");
};

export const enqueueMt5Order = (order: Mt5QueuedOrder): Mt5QueuedOrder => {
  const orders = load();

  // normalize lot sizes to broker constraints to avoid MT5 rejections
  const minLot = Number(process.env.MT5_MIN_LOT ?? 0.01);
  // default to a conservative max lot to reduce accidental large live trades
  const maxLot = Number(process.env.MT5_MAX_LOT ?? 2);
  const lotStep = Number(process.env.MT5_LOT_STEP ?? 0.01);

  const roundToStep = (value: number, step: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
    return Math.max(0, Math.floor(value / step) * step);
  };

  const adjustedLot = Math.max(minLot, Math.min(maxLot, roundToStep(order.lotSize, lotStep)));
  if (adjustedLot !== order.lotSize) {
    const note = `${order.note ?? ""}${order.note ? " | " : ""}Adjusted lot to ${adjustedLot} (min=${minLot},step=${lotStep},max=${maxLot})`;
    order = { ...order, lotSize: adjustedLot, note };
    try {
      console.warn(`MT5 enqueue: adjusted lot for ${order.symbol} from ${order.lotSize} to ${adjustedLot}`);
    } catch {
      // ignore logging errors in constrained environments
    }
  }

  // enforce global concurrent trades cap if configured
  const maxConcurrentRaw = Number(process.env.MAX_CONCURRENT_TRADES ?? 0);
  if (Number.isFinite(maxConcurrentRaw) && maxConcurrentRaw > 0) {
    const activeCount = orders.filter((o) => o.status === "PENDING" || o.status === "PROCESSING").length;
    if (activeCount >= Math.floor(maxConcurrentRaw)) {
      const blocker: Mt5QueuedOrder = {
        ...order,
        id: cryptoRandomId(),
        status: "REJECTED",
        note: `Rejected: max concurrent trades (${maxConcurrentRaw}) reached`,
        createdAt: new Date().toISOString()
      };
      // persist rejection note for auditing
      orders.push(blocker);
      save(orders);
      return blocker;
    }
  }

  const activeSameSymbol = orders.find(
    (item) =>
      item.status !== "REJECTED" &&
      sameSymbol(item, order.symbol, order.brokerSymbol) &&
      item.tradeMode === order.tradeMode &&
      item.direction === order.direction
  );

  if (activeSameSymbol) {
    return activeSameSymbol;
  }

  const cooldownMinutesByMode: Record<Mt5QueuedOrder["tradeMode"], number> = {
    scalp: 6,
    day: 15,
    swing: 45,
    position: 90
  };
  const cooldownMs = cooldownMinutesByMode[order.tradeMode] * 60_000;
  const now = Date.parse(order.createdAt);

  const recentSameSymbol = orders.find((item) => {
    if (!sameSymbol(item, order.symbol, order.brokerSymbol) || item.tradeMode !== order.tradeMode || item.direction !== order.direction) {
      return false;
    }

    const itemCreatedAt = Date.parse(item.createdAt);
    if (!Number.isFinite(itemCreatedAt) || !Number.isFinite(now)) {
      return false;
    }

    return now - itemCreatedAt < cooldownMs;
  });

  if (recentSameSymbol) {
    return recentSameSymbol;
  }

  const duplicate = orders.find((item) => item.signalHash === order.signalHash);

  if (duplicate) {
    return duplicate;
  }

  orders.push(order);
  save(orders);
  return order;
};

export const listPendingMt5Orders = (): Mt5QueuedOrder[] =>
  load()
    .filter((order) => order.status === "PENDING")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export const claimPendingMt5Orders = (maxCount: number, owner = "mt5-ea", chartSymbol?: string): Mt5QueuedOrder[] => {
  const orders = load();
  const now = Date.now();
  let changed = false;

  for (const order of orders) {
    if (order.status !== "PROCESSING" || !order.claimedAt) {
      continue;
    }

    const claimedAtMs = Date.parse(order.claimedAt);
    if (!Number.isFinite(claimedAtMs)) {
      order.status = "PENDING";
      delete order.claimedAt;
      delete order.claimOwner;
      changed = true;
      continue;
    }

    if (now - claimedAtMs > claimTtlMs) {
      order.status = "PENDING";
      delete order.claimedAt;
      delete order.claimOwner;
      changed = true;
    }
  }

  const claimed: Mt5QueuedOrder[] = [];
  for (const order of orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (claimed.length >= maxCount) {
      break;
    }
    if (order.status !== "PENDING") {
      continue;
    }
    if (!isChartSymbolMatch(order, chartSymbol)) {
      continue;
    }

    order.status = "PROCESSING";
    order.claimedAt = new Date(now).toISOString();
    order.claimOwner = owner;
    claimed.push(order);
    changed = true;
  }

  if (changed) {
    save(orders);
  }

  return claimed;
};

export const listAllMt5Orders = (): Mt5QueuedOrder[] => load();

export const ackMt5Order = (id: string, status: "FILLED" | "REJECTED", ticket?: string, note?: string): Mt5QueuedOrder | null => {
  const orders = load();
  const target = orders.find((order) => order.id === id);

  if (!target) {
    return null;
  }

  if (ticket) {
    const alreadyUsed = orders.find((order) => order.ticket === ticket && order.id !== id);
    if (alreadyUsed) {
      target.status = "REJECTED";
      target.note = `Ticket conflict with ${alreadyUsed.id}`;
      save(orders);
      return target;
    }
  }

  target.status = status;
  delete target.claimedAt;
  delete target.claimOwner;
  target.ticket = ticket;
  target.note = note;
  save(orders);
  return target;
};
