import { enqueueMt5Order } from "../execution/mt5Bridge.js";

const main = async () => {
  const now = new Date().toISOString();
  const order = {
    id: `manual-${Date.now()}`,
    signalHash: `manual-${Date.now()}-sig`,
    symbol: "GBPUSD",
    brokerSymbol: "GBPUSD",
    tradeMode: "day",
    direction: "BUY",
    orderType: "BUY_MARKET",
    entry: 1.27,
    stopLoss: 1.26,
    takeProfit: 1.28,
    lotSize: 0.05,
    trailing: { breakEvenR: 1.15, trailStartR: 1.8, trailStepR: 1 },
    createdAt: now,
    status: "PENDING"
  } as any;

  const res = enqueueMt5Order(order);
  console.log('Enqueue manual result:', res);
};

void main();
