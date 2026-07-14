import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { analyzeSetup } from "./strategy/smcCrtStrategy.js";
import { validateRiskParams, computePositionSizing } from "./risk/riskManager.js";
import type { AnalyzeRequest } from "./types/contracts.js";
import type { LiveAnalyzeRequest, MarketType, Timeframe } from "./types/market.js";
import { INSTRUMENTS, findInstrument } from "./market/catalog.js";
import { getMarketCandles } from "./market/service.js";
import { getStats, listTrades, recordSignalTrade, resetJournal, resolveOpenTrades } from "./journal/tradeJournal.js";
import { executeSignalOrder, isAutoExecutionEnabled } from "./execution/executor.js";
import { ackMt5Order, listAllMt5Orders, listPendingMt5Orders } from "./execution/mt5Bridge.js";

const app = express();
const port = process.env.PORT ?? 4000;
const marketPollIntervalMs = Number(process.env.MARKET_POLL_INTERVAL_MS ?? 15000);
const watchlistPollIntervalMs = Number(process.env.WATCHLIST_POLL_INTERVAL_MS ?? 30000);
const executedSignalKeys = new Set<string>();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.status(200).send(
    "FX bot API is running. Check /api/health, /api/automation/status, or /api/instruments."
  );
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fx-bot-server" });
});

app.get("/api/instruments", (_req, res) => {
  res.json({ instruments: INSTRUMENTS });
});

app.get("/api/journal/trades", (_req, res) => {
  res.json({ trades: listTrades() });
});

app.get("/api/journal/stats", (_req, res) => {
  res.json({ stats: getStats() });
});

app.post("/api/journal/reset", (_req, res) => {
  resetJournal();
  res.json({ ok: true });
});

app.get("/api/automation/status", (_req, res) => {
  res.json({
    enabled: isAutoExecutionEnabled(),
    broker: process.env.BROKER ?? "paper",
    mt5PendingOrders: listPendingMt5Orders().length,
    mt5SymbolPrefix: process.env.MT5_SYMBOL_PREFIX ?? "",
    mt5SymbolSuffix: process.env.MT5_SYMBOL_SUFFIX ?? ""
  });
});

app.get("/api/mt5/trailing-rules", (req, res) => {
  if (!isMt5Authorized(req)) {
    return res.status(401).json({ error: "Unauthorized MT5 bridge request." });
  }

  return res.json({
    scalp: { breakEvenR: 0.8, trailStartR: 1.2, trailStepR: 0.6 },
    day: { breakEvenR: 1.0, trailStartR: 1.6, trailStepR: 0.9 },
    swing: { breakEvenR: 1.2, trailStartR: 1.8, trailStepR: 1.0 },
    position: { breakEvenR: 1.4, trailStartR: 2.2, trailStepR: 1.2 }
  });
});

const isMt5Authorized = (req: express.Request): boolean => {
  console.log("Received:", req.header("x-mt5-secret"));
  console.log("Expected:", process.env.MT5_SHARED_SECRET);

  if (!process.env.MT5_SHARED_SECRET) {
  return true;
}

  const provided = req.header("x-mt5-secret") ?? "";
  return provided === process.env.MT5_SHARED_SECRET;
};

app.get("/api/mt5/orders/pending", (req, res) => {
  if (!isMt5Authorized(req)) {
    return res.status(401).json({ error: "Unauthorized MT5 bridge request." });
  }

  const orders = listPendingMt5Orders();

  console.log("Pending orders:", JSON.stringify(orders, null, 2));

  return res.json({ orders });
});

app.get("/api/mt5/orders/all", (req, res) => {
  if (!isMt5Authorized(req)) {
    return res.status(401).json({ error: "Unauthorized MT5 bridge request." });
  }
  return res.json({ orders: listAllMt5Orders() });
});

app.post("/api/mt5/orders/ack", (req, res) => {
  if (!isMt5Authorized(req)) {
    return res.status(401).json({ error: "Unauthorized MT5 bridge request." });
  }

  const body = req.body as { id?: string; status?: "FILLED" | "REJECTED"; ticket?: string; note?: string };
  if (!body.id || !body.status) {
    return res.status(400).json({ error: "Provide id and status for order acknowledgment." });
  }

  const updated = ackMt5Order(body.id, body.status, body.ticket, body.note);
  if (!updated) {
    return res.status(404).json({ error: "Order not found." });
  }

  return res.json({ order: updated });
});

app.get("/api/market/candles", async (req, res) => {
  const market = String(req.query.market ?? "") as MarketType;
  const symbol = String(req.query.symbol ?? "");
  const timeframe = String(req.query.timeframe ?? "M15") as Timeframe;
  const limit = Number(req.query.limit ?? 200);

  try {
    const candles = await getMarketCandles(market, symbol, timeframe, limit);
    res.json({ market, symbol, timeframe, candles });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/analyze-live", async (req, res) => {
  const body = req.body as LiveAnalyzeRequest;

  if (!findInstrument(body.market, body.symbol)) {
    return res.status(400).json({ error: "Unsupported market/symbol selection." });
  }

  const riskValidation = validateRiskParams(body.risk);
  if (!riskValidation.valid) {
    return res.status(400).json({ error: riskValidation.message });
  }

  try {
    const candles = await getMarketCandles(body.market, body.symbol, body.timeframe, 220);
    if (candles.length < 20) {
      return res.status(400).json({ error: "Not enough candles returned by provider." });
    }

    const setup = analyzeSetup({
      pair: body.symbol,
      timeframe: body.timeframe,
      tradeMode: body.tradeMode,
      candles,
      risk: body.risk,
      quoteCurrency: "USD"
    });

    const sizing = computePositionSizing({
      accountBalance: body.risk.accountBalance,
      riskPercent: body.risk.riskPercent,
      entry: setup.entry,
      stopLoss: setup.stopLoss,
      pair: body.symbol,
      quoteCurrency: "USD"
    });

    const signalPayload = {
      snapshot: {
        market: body.market,
        symbol: body.symbol,
        timeframe: body.timeframe,
        candles
      },
      setup,
      risk: sizing,
      updatedAt: new Date().toISOString()
    };

    recordSignalTrade(signalPayload, "signal");
    resolveOpenTrades(signalPayload);

    return res.json({
      ...signalPayload,
      meta: {
        model: "ICT-inspired SMC/CRT engine",
        note: "No trading system can guarantee 100% accuracy. Always validate and manage risk."
      }
    });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/analyze", (req, res) => {
  const body = req.body as AnalyzeRequest;

  if (!body || !Array.isArray(body.candles) || body.candles.length < 20) {
    return res.status(400).json({
      error: "Provide at least 20 candles for analysis."
    });
  }

  const riskValidation = validateRiskParams(body.risk);
  if (!riskValidation.valid) {
    return res.status(400).json({ error: riskValidation.message });
  }

  const setup = analyzeSetup(body);
  const sizing = computePositionSizing({
    accountBalance: body.risk.accountBalance,
    riskPercent: body.risk.riskPercent,
    entry: setup.entry,
    stopLoss: setup.stopLoss,
    pair: body.pair,
    quoteCurrency: body.quoteCurrency ?? "USD"
  });

  return res.json({
    meta: {
      pair: body.pair,
      timeframe: body.timeframe,
      model: "SMC+CRT heuristic engine",
      note: "No trading system can guarantee 98% or 100% win rate. Use with caution."
    },
    setup,
    risk: sizing
  });
});

io.on("connection", (socket) => {
  let marketTimer: NodeJS.Timeout | undefined;
  let watchlistTimer: NodeJS.Timeout | undefined;

  socket.on(
    "market:subscribe",
    async (payload: {
      market: MarketType;
      symbol: string;
      timeframe: Timeframe;
      tradeMode?: "scalp" | "day" | "swing" | "position";
      risk: { accountBalance: number; riskPercent: number };
    }) => {
      if (marketTimer) {
        clearInterval(marketTimer);
      }

      const tick = async () => {
        try {
          const candles = await getMarketCandles(payload.market, payload.symbol, payload.timeframe, 220);
          if (candles.length < 20) {
            return;
          }

          const setup = analyzeSetup({
            pair: payload.symbol,
            timeframe: payload.timeframe,
            tradeMode: payload.tradeMode,
            candles,
            risk: payload.risk,
            quoteCurrency: "USD"
          });

          const sizing = computePositionSizing({
            accountBalance: payload.risk.accountBalance,
            riskPercent: payload.risk.riskPercent,
            entry: setup.entry,
            stopLoss: setup.stopLoss,
            pair: payload.symbol,
            quoteCurrency: "USD"
          });

          const signalPayload = {
            snapshot: {
              market: payload.market,
              symbol: payload.symbol,
              timeframe: payload.timeframe,
              candles
            },
            setup,
            risk: sizing,
            updatedAt: new Date().toISOString()
          };

          resolveOpenTrades(signalPayload);

         const signalKey = `${payload.market}:${payload.symbol}:${payload.timeframe}:${setup.appliedMode}:${setup.direction}:${setup.entry}`;

console.log("==================================");
console.log("Signal Quality:", setup.signalQuality);
console.log("Direction:", setup.direction);
console.log("Confidence:", setup.confidence);
console.log("RR:", setup.rr);
console.log("Already Executed:", executedSignalKeys.has(signalKey));
console.log("==================================");

if (setup.signalQuality === "PERFECT" && setup.direction !== "NEUTRAL" && !executedSignalKeys.has(signalKey)) {
    console.log("AUTO EXECUTION STARTED");

    const execution = await executeSignalOrder(signalPayload);

    if (execution.executed) {
        executedSignalKeys.add(signalKey);
        recordSignalTrade(signalPayload, "auto-execution");
        socket.emit("execution:update", execution);
    } else {
        socket.emit("execution:update", execution);
        recordSignalTrade(signalPayload, "signal");
    }
} else {
    recordSignalTrade(signalPayload, "signal");
}
            if (execution.executed) {
              console.log("AUTO EXECUTION STARTED");
              executedSignalKeys.add(signalKey);
              recordSignalTrade(signalPayload, "auto-execution");
              socket.emit("execution:update", execution);
            } else {
              socket.emit("execution:update", execution);
              recordSignalTrade(signalPayload, "signal");
            }
          } else {
            recordSignalTrade(signalPayload, "signal");
          }

          socket.emit("market:update", signalPayload);
        } catch (error) {
          const message = (error as Error).message;
          if (message.includes("Yahoo data error: 429")) {
            return;
          }
          socket.emit("market:error", { error: message });
        }
      };

      await tick();
      marketTimer = setInterval(tick, marketPollIntervalMs);
    }
  );

  socket.on(
    "market:watchlist",
    (payload: {
      items: Array<{ market: MarketType; symbol: string; timeframe: Timeframe }>;
      tradeMode?: "scalp" | "day" | "swing" | "position";
      risk: { accountBalance: number; riskPercent: number };
    }) => {
      if (watchlistTimer) {
        clearInterval(watchlistTimer);
      }

      const selected = payload.items.slice(0, 3);
      if (selected.length === 0) {
        return;
      }

      const tickWatchlist = async () => {
        for (const item of selected) {
          try {
            const candles = await getMarketCandles(item.market, item.symbol, item.timeframe, 220);
            if (candles.length < 20) {
              continue;
            }

            const setup = analyzeSetup({
              pair: item.symbol,
              timeframe: item.timeframe,
              tradeMode: payload.tradeMode,
              candles,
              risk: payload.risk,
              quoteCurrency: "USD"
            });

            const sizing = computePositionSizing({
              accountBalance: payload.risk.accountBalance,
              riskPercent: payload.risk.riskPercent,
              entry: setup.entry,
              stopLoss: setup.stopLoss,
              pair: item.symbol,
              quoteCurrency: "USD"
            });

            const signalPayload = {
              snapshot: {
                market: item.market,
                symbol: item.symbol,
                timeframe: item.timeframe,
                candles
              },
              setup,
              risk: sizing,
              updatedAt: new Date().toISOString()
            };

            resolveOpenTrades(signalPayload);
            recordSignalTrade(signalPayload, "signal");

            socket.emit("watch:update", signalPayload);

            if (setup.signalQuality === "PERFECT") {
              socket.emit("watch:perfect-entry", signalPayload);
            }
          } catch (error) {
            const message = (error as Error).message;
            if (message.includes("Yahoo data error: 429")) {
              continue;
            }
            socket.emit("watch:error", {
              market: item.market,
              symbol: item.symbol,
              error: message
            });
          }
        }
      };

      void tickWatchlist();
      watchlistTimer = setInterval(() => {
        void tickWatchlist();
      }, watchlistPollIntervalMs);
    }
  );

  socket.on("disconnect", () => {
    if (marketTimer) {
      clearInterval(marketTimer);
    }
    if (watchlistTimer) {
      clearInterval(watchlistTimer);
    }
  });
});

httpServer.listen(port, () => {
  console.log(`FX bot server listening on port ${port}`);
});
