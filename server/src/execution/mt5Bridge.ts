import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Mt5OrderStatus = "PENDING" | "FILLED" | "REJECTED";

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
  orderType: "BUY_LIMIT" | "SELL_LIMIT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  trailing: Mt5TrailingRules;
  createdAt: string;
  status: Mt5OrderStatus;
  ticket?: string;
  note?: string;
};

const dataDir = join(process.cwd(), "data");
const filePath = join(dataDir, "mt5-orders.json");

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

  const duplicate = orders.find(
    (item) => item.signalHash === order.signalHash && (item.status === "PENDING" || item.status === "FILLED")
  );

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
  target.ticket = ticket;
  target.note = note;
  save(orders);
  return target;
};
