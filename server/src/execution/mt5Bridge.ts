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
  orderType: "BUY_LIMIT" | "SELL_LIMIT" | "BUY_MARKET" | "SELL_MARKET";
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

export const claimPendingMt5Orders = (maxCount: number, owner = "mt5-ea"): Mt5QueuedOrder[] => {
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
