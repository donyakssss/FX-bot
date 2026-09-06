import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { analyzeSetup } from "./strategy/index.js";
import { validateRiskParams, computePositionSizing } from "./risk/riskManager.js";
import type { AnalyzeRequest, ExecutionPreferences } from "./types/contracts.js";
import type { LiveAnalyzeRequest, MarketType, Timeframe } from "./types/market.js";
import { INSTRUMENTS, findInstrument } from "./market/catalog.js";
import { getMarketCandles } from "./market/service.js";
import { getFundamentalContext } from "./market/fundamentals.js";
import { getNewsBlockDecision, getUpcomingEconomicEvents } from "./market/economicCalendar.js";
import { getStats, listTrades, recordSignalTrade, resetJournal, resolveOpenTrades } from "./journal/tradeJournal.js";
import { executeSignalOrder, isAutoExecutionEnabled } from "./execution/executor.js";
import { ackMt5Order, claimPendingMt5Orders, listAllMt5Orders, listPendingMt5Orders } from "./execution/mt5Bridge.js";

const app = express();
const port = process.env.PORT ?? 4000;
const marketPollIntervalMs = Number(process.env.MARKET_POLL_INTERVAL_MS ?? 15000);
const watchlistPollIntervalMs = Number(process.env.WATCHLIST_POLL_INTERVAL_MS ?? 30000);
const backgroundAutotradeEnabled = process.env.BACKGROUND_AUTOTRADE_ENABLED === "true";
const backgroundPollIntervalMs = Number(process.env.BACKGROUND_POLL_INTERVAL_MS ?? 20000);
const oneTapEntryDefault = process.env.ONE_TAP_ENTRY_DEFAULT !== "false";
const enableTrailingDefault = process.env.ENABLE_TRAILING_DEFAULT !== "false";
const moveSlToBreakevenDefault = process.env.MOVE_SL_TO_BREAKEVEN_DEFAULT !== "false";
const significantShiftOnlyDefault = process.env.SIGNIFICANT_SHIFT_ONLY_DEFAULT !== "false";
const executedSignalKeys = new Set<string>();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*"
  }
});

const LEGACY_MT5_SHARED_SECRET = "2aHV4uomWzl/F9F2KGygTIBXRqGGA/LVeE6NWmfsDOE=";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
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

app.get("/api/fundamentals/calendar", async (req, res) => {
  const market = String(req.query.market ?? "") as MarketType;
  const symbol = String(req.query.symbol ?? "").trim();
  const horizonHours = Number(req.query.horizonHours ?? 24);

  if (!findInstrument(market, symbol)) {
    return res.status(400).json({ error: "Unsupported market/symbol selection." });
  }

  const events = await getUpcomingEconomicEvents({
    market,
    symbol,
    horizonHours: Number.isFinite(horizonHours) ? Math.max(1, Math.min(168, horizonHours)) : 24
  });

  return res.json({ market, symbol, events, updatedAt: new Date().toISOString() });
});

app.get("/api/fundamentals/news-block", async (req, res) => {
  const market = String(req.query.market ?? "") as MarketType;
  const symbol = String(req.query.symbol ?? "").trim();

  if (!findInstrument(market, symbol)) {
    return res.status(400).json({ error: "Unsupported market/symbol selection." });
  }

  const decision = await getNewsBlockDecision({ market, symbol });
  return res.json({ market, symbol, decision, checkedAt: new Date().toISOString() });
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
  const targets = readBackgroundTargets();
  res.json({
    enabled: isAutoExecutionEnabled(),
    broker: process.env.BROKER ?? "paper",
    mt5PendingOrders: listPendingMt5Orders().length,
    mt5SymbolPrefix: process.env.MT5_SYMBOL_PREFIX ?? "",
    mt5SymbolSuffix: process.env.MT5_SYMBOL_SUFFIX ?? "",
    backgroundTargets: targets.map((target) => ({
      market: target.market,
      symbol: target.symbol,
      timeframe: target.timeframe,
      tradeMode: target.tradeMode
    }))
  });
});

app.get("/api/mt5/trailing-rules", (req, res) => {
  if (!isMt5Authorized(req)) {
    return res.status(401).json({ error: "Unauthorized MT5 bridge request." });
  }

  return res.json({
    scalp: { breakEvenR: 1.0, trailStartR: 1.4, trailStepR: 0.75 },
    day: { breakEvenR: 1.15, trailStartR: 1.8, trailStepR: 1.0 },
    swing: { breakEvenR: 1.35, trailStartR: 2.1, trailStepR: 1.2 },
    position: { breakEvenR: 1.6, trailStartR: 2.6, trailStepR: 1.4 }
  });
});

const isMt5Authorized = (req: express.Request): boolean => {
  if (!process.env.MT5_SHARED_SECRET && !LEGACY_MT5_SHARED_SECRET) {
    return true;
  }

  const provided = req.header("x-mt5-secret") ?? String(req.query.mt5Secret ?? "");
  const configuredSecret = process.env.MT5_SHARED_SECRET?.trim();

  return [configuredSecret, LEGACY_MT5_SHARED_SECRET].some((secret) => secret && provided === secret);
};

const validateLiveInstrument = (
  market: MarketType,
  symbol: string
): { ok: true } | { ok: false; error: string } => {
  const instrument = findInstrument(market, symbol);
  if (!instrument) {
    return { ok: false, error: `Unsupported instrument ${market}:${symbol}` };
  }

  return { ok: true };
};

const resolveExecutionPreferences = (
  incoming?: ExecutionPreferences
): Required<ExecutionPreferences> => ({
  oneTapEntry: incoming?.oneTapEntry ?? oneTapEntryDefault,
  enableTrailing: incoming?.enableTrailing ?? enableTrailingDefault,
  moveSlToBreakeven: incoming?.moveSlToBreakeven ?? moveSlToBreakevenDefault,
  significantShiftOnly: incoming?.significantShiftOnly ?? significantShiftOnlyDefault
});

type BackgroundTarget = {
  market: MarketType;
  symbol: string;
  timeframe: Timeframe;
  tradeMode: "scalp" | "day" | "swing" | "position";
  accountBalance: number;
  riskPercent: number;
};

const isMarketType = (value: string): value is MarketType =>
  value === "forex" || value === "crypto" || value === "indices" || value === "metals" || value === "synthetics";

const mt5BackgroundMarkets: MarketType[] = ["forex", "crypto", "indices", "metals"];

const parseCsv = (raw?: string): string[] =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const readBackgroundTargets = (): BackgroundTarget[] => {
  const timeframe = (process.env.BACKGROUND_TIMEFRAME ?? "M15") as Timeframe;
  const tradeMode = (process.env.BACKGROUND_TRADE_MODE ?? "day") as "scalp" | "day" | "swing" | "position";
  const accountBalance = Number(process.env.BACKGROUND_ACCOUNT_BALANCE ?? 5000);
  const riskPercent = Number(process.env.BACKGROUND_RISK_PERCENT ?? 5);

  const fromJson = process.env.BACKGROUND_TARGETS_JSON;
  if (fromJson) {
    try {
      const parsed = JSON.parse(fromJson) as BackgroundTarget[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (error) {
      console.error("Invalid BACKGROUND_TARGETS_JSON:", (error as Error).message);
    }
  }

  if (process.env.BACKGROUND_ALL_SYMBOLS === "true") {
    const requestedMarkets = parseCsv(process.env.BACKGROUND_MARKETS)
      .map((value) => value.toLowerCase())
      .filter(isMarketType);

    const selectedMarkets = requestedMarkets.length > 0 ? requestedMarkets : mt5BackgroundMarkets;
    const marketSet = new Set<MarketType>(selectedMarkets);

    const allTargets = INSTRUMENTS
      .filter((instrument) => marketSet.has(instrument.market))
      .map((instrument) => ({
        market: instrument.market,
        symbol: instrument.symbol,
        timeframe,
        tradeMode,
        accountBalance,
        riskPercent
      }));

    if (allTargets.length > 0) {
      return allTargets;
    }
  }

  const symbolsRaw = process.env.BACKGROUND_SYMBOLS;
  if (symbolsRaw) {
    const market = (process.env.BACKGROUND_MARKET ?? "forex") as MarketType;

    const symbols = parseCsv(symbolsRaw);

    if (symbols.length > 0) {
      return symbols.map((symbol) => ({
        market,
        symbol,
        timeframe,
        tradeMode,
        accountBalance,
        riskPercent
      }));
    }
  }

  return [
    {
      market: (process.env.BACKGROUND_MARKET ?? "forex") as MarketType,
      symbol: process.env.BACKGROUND_SYMBOL ?? "EURUSD",
      timeframe,
      tradeMode,
      accountBalance,
      riskPercent
    }
  ];
};

const runBackgroundAutotrade = (): void => {
  if (!backgroundAutotradeEnabled) {
    return;
  }

  const targets = readBackgroundTargets().filter((target) => {
    const instrumentCheck = validateLiveInstrument(target.market, target.symbol);
    if (!instrumentCheck.ok) {
      console.error("Background target disabled:", instrumentCheck.error);
      return false;
    }
    return true;
  });

  if (targets.length === 0) {
    console.error("Background autotrade disabled: no valid targets.");
    return;
  }

  const tick = async () => {
    for (const target of targets) {
      try {
        const candles = await getMarketCandles(target.market, target.symbol, target.timeframe, 220);
        if (candles.length < 20) {
          continue;
        }

        const setup = analyzeSetup({
          pair: target.symbol,
          timeframe: target.timeframe,
          tradeMode: target.tradeMode,
          candles,
          fundamentals: await getFundamentalContext(target.market, target.symbol),
          risk: { accountBalance: target.accountBalance, riskPercent: target.riskPercent },
          quoteCurrency: "USD"
        });

        const sizing = computePositionSizing({
          accountBalance: target.accountBalance,
          riskPercent: target.riskPercent,
          entry: setup.entry,
          stopLoss: setup.stopLoss,
          pair: target.symbol,
          quoteCurrency: "USD"
        });

        const signalPayload = {
          snapshot: {
            market: target.market,
            symbol: target.symbol,
            timeframe: target.timeframe,
            candles
          },
          setup,
          risk: sizing,
          updatedAt: new Date().toISOString()
        };

        resolveOpenTrades(signalPayload);
        const signalKey = `background:${target.market}:${target.symbol}:${target.timeframe}:${setup.appliedMode}:${setup.direction}:${setup.entry}`;

        if (setup.direction !== "NEUTRAL" && !executedSignalKeys.has(signalKey)) {
          const newsBlock = await getNewsBlockDecision({ market: target.market, symbol: target.symbol });
          if (newsBlock.blocked) {
            recordSignalTrade(signalPayload, "signal");
            continue;
          }

          const execution = await executeSignalOrder(signalPayload, resolveExecutionPreferences());
          if (execution.executed) {
            executedSignalKeys.add(signalKey);
            recordSignalTrade(signalPayload, "auto-execution");
          } else {
            recordSignalTrade(signalPayload, "signal");
          }
        } else {
          recordSignalTrade(signalPayload, "signal");
        }
      } catch (error) {
        const message = (error as Error).message;
        if (message.includes("Yahoo data error: 429")) {
          continue;
        }
        console.error("Background autotrade error:", message);
      }
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, backgroundPollIntervalMs);
};

app.get("/api/mt5/orders/pending", (req, res) => {
    console.log("===== PENDING REQUEST =====");

    if (!isMt5Authorized(req)) {
        console.log("Unauthorized request");
        return res.status(401).json({
            error: "Unauthorized"
        });
    }

    const maxRaw = Number(req.query.max ?? 5);
    const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(20, Math.floor(maxRaw))) : 5;
    const owner = String(req.query.mt5Owner ?? "mt5-ea");
    const chartSymbol = String(req.query.mt5ChartSymbol ?? "").trim();
    const orders = claimPendingMt5Orders(max, owner, chartSymbol || undefined);

    console.log("Orders:", JSON.stringify(orders, null, 2));

    return res.json({
        orders
    });
});

app.get("/api/mt5/orders/all", (req, res) => {
  if (!isMt5Authorized(req)) {
    return res.status(401).json({ error: "Unauthorized MT5 bridge request." });
  }

  const limitRaw = Number(req.query.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;

  const orders = listAllMt5Orders()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  const summary = {
    total: orders.length,
    pending: orders.filter((o) => o.status === "PENDING").length,
    processing: orders.filter((o) => o.status === "PROCESSING").length,
    filled: orders.filter((o) => o.status === "FILLED").length,
    rejected: orders.filter((o) => o.status === "REJECTED").length
  };

  return res.json({ summary, orders });
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

app.get("/api/mt5/orders/ack", (req, res) => {
  if (!isMt5Authorized(req)) {
    return res.status(401).json({ error: "Unauthorized MT5 bridge request." });
  }

  const id = String(req.query.id ?? "");
  const status = String(req.query.status ?? "") as "FILLED" | "REJECTED";
  const ticket = String(req.query.ticket ?? "");
  const note = String(req.query.note ?? "");

  if (!id || (status !== "FILLED" && status !== "REJECTED")) {
    return res.status(400).json({ error: "Provide id and valid status for order acknowledgment." });
  }

  const updated = ackMt5Order(id, status, ticket || undefined, note || undefined);
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
      fundamentals: await getFundamentalContext(body.market, body.symbol),
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
    const newsBlock = await getNewsBlockDecision({ market: body.market, symbol: body.symbol });
    resolveOpenTrades(signalPayload);
    recordSignalTrade(signalPayload, "signal");

    return res.json({
      ...signalPayload,
      riskControls: {
        newsBlock
      },
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

app.post("/api/annotations", (req, res) => {
  const body = req.body as AnalyzeRequest;
  if (!body || !Array.isArray(body.candles) || body.candles.length < 20) {
    return res.status(400).json({ error: "Provide at least 20 candles for annotations." });
  }

  try {
    const setup = analyzeSetup(body);

    const candles = body.candles;
    const prices = candles.flatMap((c) => [c.high, c.low, c.open, c.close]);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const width = 1200;
    const height = 480;

    const yForPrice = (p: number) => {
      const pct = (p - minP) / (maxP - minP || 1);
      return Math.round(height - pct * height);
    };

    // prepare candle drawing
    const padLeft = 60;
    const padRight = 20;
    const chartW = width - padLeft - padRight;
    const step = chartW / Math.max(1, candles.length - 1);

    const candleElems: string[] = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const x = padLeft + Math.round(i * step);
      const yHigh = yForPrice(c.high);
      const yLow = yForPrice(c.low);
      const yOpen = yForPrice(c.open);
      const yClose = yForPrice(c.close);
      const up = c.close >= c.open;
      const color = up ? "#39c98a" : "#f65f60";
      const wick = `<line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1" />`;
      const bodyTop = Math.min(yOpen, yClose);
      const bodyBottom = Math.max(yOpen, yClose);
      const bodyH = Math.max(1, bodyBottom - bodyTop);
      const body = `<rect x="${x - step * 0.35}" y="${bodyTop}" width="${Math.max(2, step * 0.7)}" height="${bodyH}" fill="${color}" />`;
      candleElems.push(wick);
      candleElems.push(body);
    }

    const annotationElems: string[] = [];
    for (const a of (setup.annotations ?? [])) {
      const y = yForPrice(a.price);
      const color = a.type === "SUPPORT" ? "#7fdbca" : a.type === "RESISTANCE" ? "#b388eb" : a.type === "NOTE" ? "#f2c94c" : "#9bd1ff";
      annotationElems.push(`<g><line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="${color}" stroke-width="2" stroke-dasharray="6,4" /><text x="${padLeft + 6}" y="${y - 8}" fill="${color}" font-size="14">${(a.label ?? a.type) + ' ' + a.price.toFixed(5)}</text></g>`);
    }

    // time axis ticks
    const tickCount = Math.min(10, Math.max(3, Math.floor(candles.length / 6)));
    const tickStep = Math.max(1, Math.floor((candles.length - 1) / (tickCount - 1)));
    const ticks: string[] = [];
    for (let i = 0; i < candles.length; i += tickStep) {
      const x = padLeft + Math.round(i * step);
      const t = new Date(candles[i].time).toISOString().replace(/T/, ' ').replace(/Z/, '');
      ticks.push(`<g><line x1="${x}" y1="${height - 36}" x2="${x}" y2="${height - 32}" stroke="#436879" stroke-width="1" /><text x="${x - 28}" y="${height - 14}" fill="#9fbfcd" font-size="12">${t}</text></g>`);
    }

    // price axis labels (6 divisions)
    const priceLabels: string[] = [];
    const divisions = 6;
    for (let i = 0; i <= divisions; i++) {
      const p = minP + ((maxP - minP) * i) / divisions;
      const y = yForPrice(p);
      priceLabels.push(`<g><text x="${width - padRight + 6}" y="${y + 4}" fill="#9fbfcd" font-size="12">${p.toFixed(5)}</text></g>`);
    }

    // legend box
    const legendX = padLeft + 8;
    const legendY = 8;
    const legendLines: string[] = [];
    legendLines.push(`${setup.strategyVersion}`);
    legendLines.push(`Dir: ${setup.direction}  Q: ${setup.signalQuality}`);
    legendLines.push(`RR: ${setup.rr}  Conf: ${setup.confidence}`);
    if (setup.futureEntries && setup.futureEntries.length > 0) {
      legendLines.push(`Allocations: ${setup.futureEntries.map((f) => f.allocationPercent + '%').join(', ')}`);
    }

    const legendElems = [`<rect x="${legendX - 6}" y="${legendY - 14}" width="320" height="${12 * legendLines.length + 12}" rx="6" fill="rgba(10,20,26,0.6)" stroke="#234" />`];
    for (let i = 0; i < legendLines.length; i++) {
      legendElems.push(`<text x="${legendX}" y="${legendY + i * 14}" fill="#d7ebf9" font-size="12">${legendLines[i]}</text>`);
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#07121a" />
        <g>${candleElems.join("\n")}</g>
        <g>${annotationElems.join("\n")}</g>
        <g>${ticks.join("\n")}</g>
        <g>${priceLabels.join("\n")}</g>
        <g>${legendElems.join("\n")}</g>
      </svg>`;

    const want = String(req.query.format ?? "svg").toLowerCase();
    if (want === "png") {
      try {
        const sharp = await import("sharp");
        const buf = await sharp.default(Buffer.from(svg)).png().toBuffer();
        res.setHeader("Content-Type", "image/png");
        return res.status(200).send(buf);
      } catch (err) {
        // fallback to svg if sharp not available or conversion failed
        res.setHeader("Content-Type", "image/svg+xml");
        return res.status(200).send(svg);
      }
    }

    res.setHeader("Content-Type", "image/svg+xml");
    return res.status(200).send(svg);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
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
      execution?: ExecutionPreferences;
    }) => {
      if (marketTimer) {
        clearInterval(marketTimer);
      }

      const instrumentCheck = validateLiveInstrument(payload.market, payload.symbol);
      if (!instrumentCheck.ok) {
        socket.emit("market:error", { error: instrumentCheck.error });
        return;
      }

      const tick = async () => {
        try {
          if (!findInstrument(payload.market, payload.symbol)) {
            socket.emit("market:error", {
              error: `Unsupported instrument ${payload.market}:${payload.symbol}`
            });
            return;
          }

          const candles = await getMarketCandles(payload.market, payload.symbol, payload.timeframe, 220);
          if (candles.length < 20) {
            return;
          }

          const setup = analyzeSetup({
            pair: payload.symbol,
            timeframe: payload.timeframe,
            tradeMode: payload.tradeMode,
            candles,
            fundamentals: await getFundamentalContext(payload.market, payload.symbol),
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
          const executionPrefs = resolveExecutionPreferences(payload.execution);

          if (setup.direction !== "NEUTRAL" && !executedSignalKeys.has(signalKey)) {
            const newsBlock = await getNewsBlockDecision({ market: payload.market, symbol: payload.symbol });
            if (newsBlock.blocked) {
              const message = newsBlock.reason ?? "Execution blocked by high-impact economic event window.";
              socket.emit("execution:update", {
                executed: false,
                broker: process.env.BROKER ?? "paper",
                message
              });
              recordSignalTrade(signalPayload, "signal");
              socket.emit("market:update", {
                ...signalPayload,
                riskControls: { newsBlock }
              });
              return;
            }

            const execution = await executeSignalOrder(signalPayload, executionPrefs);
            socket.emit("execution:update", execution);

            if (execution.executed) {
              executedSignalKeys.add(signalKey);
              recordSignalTrade(signalPayload, "auto-execution");
            } else {
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

      const selected = payload.items.slice(0, 3).filter((item) => {
        const instrumentCheck = validateLiveInstrument(item.market, item.symbol);
        if (!instrumentCheck.ok) {
          socket.emit("watch:error", {
            market: item.market,
            symbol: item.symbol,
            error: instrumentCheck.error
          });
          return false;
        }

        return true;
      });
      if (selected.length === 0) {
        return;
      }

      const tickWatchlist = async () => {
        for (const item of selected) {
          try {
            if (!findInstrument(item.market, item.symbol)) {
              socket.emit("watch:error", {
                market: item.market,
                symbol: item.symbol,
                error: `Unsupported instrument ${item.market}:${item.symbol}`
              });
              continue;
            }

            const candles = await getMarketCandles(item.market, item.symbol, item.timeframe, 220);
            if (candles.length < 20) {
              continue;
            }

            const setup = analyzeSetup({
              pair: item.symbol,
              timeframe: item.timeframe,
              tradeMode: payload.tradeMode,
              candles,
              fundamentals: await getFundamentalContext(item.market, item.symbol),
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
  runBackgroundAutotrade();
});
