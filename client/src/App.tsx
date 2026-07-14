import { useEffect, useMemo, useState } from "react";
import LiveChart from "./components/LiveChart";
import ResultCard from "./components/ResultCard";
import {
  analyzeLive,
  connectLiveSocket,
  getInstruments,
  type Instrument,
  type LiveUpdate,
  type MarketType,
  type TradeMode,
  type Timeframe
} from "./api/live";
import { getAutomationStatus, getJournalStats, getRecentTrades, type JournalStats, type TradeRecord } from "./api/journal";

const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
const MARKETS: MarketType[] = ["forex", "crypto", "indices", "metals", "synthetics"];
const TRADE_MODES: Array<{ value: TradeMode; label: string }> = [
  { value: "scalp", label: "Scalping (Short-Term)" },
  { value: "day", label: "Day Trading (Short-Term)" },
  { value: "swing", label: "Swing Trading (Medium-Term)" },
  { value: "position", label: "Position Trading (Long-Term)" }
];
const FAVORITES_KEY = "fxbot:favorites";

type FavoriteItem = {
  market: MarketType;
  symbol: string;
  timeframe: Timeframe;
};

const favKey = (item: FavoriteItem): string => `${item.market}:${item.symbol}:${item.timeframe}`;

const readFavorites = (): FavoriteItem[] => {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as FavoriteItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch {
    return [];
  }
};

export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [market, setMarket] = useState<MarketType>("forex");
  const [symbol, setSymbol] = useState("EURUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>("H4");
  const [tradeMode, setTradeMode] = useState<TradeMode>("swing");
  const [balance, setBalance] = useState(5000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [result, setResult] = useState<LiveUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => readFavorites());
  const [watchSignals, setWatchSignals] = useState<Record<string, LiveUpdate>>({});
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeRecord[]>([]);
  const [automation, setAutomation] = useState<{ enabled: boolean; broker: string } | null>(null);

  const marketInstruments = useMemo(
    () => instruments.filter((item) => item.market === market),
    [instruments, market]
  );

  useEffect(() => {
    getInstruments()
      .then((items) => {
        setInstruments(items);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (marketInstruments.length === 0) {
      return;
    }

    if (!marketInstruments.some((item) => item.symbol === symbol)) {
      setSymbol(marketInstruments[0].symbol);
    }
  }, [marketInstruments, symbol]);

  const [socket] = useState(() => connectLiveSocket());

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    setConnected(socket.connected);
    if (!socket.connected) {
      socket.connect();
    }

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("market:update", (payload: LiveUpdate) => {
      setResult(payload);
      setError(null);
    });
    socket.on("market:error", (payload: { error: string }) => {
      if (payload.error.includes("Yahoo data error: 429")) {
        return;
      }
      setError(payload.error);
    });
    socket.on("watch:update", (payload: LiveUpdate) => {
      const key = favKey({
        market: payload.snapshot.market,
        symbol: payload.snapshot.symbol,
        timeframe: payload.snapshot.timeframe
      });
      setWatchSignals((prev) => ({ ...prev, [key]: payload }));
    });

    socket.on("watch:perfect-entry", (payload: LiveUpdate) => {
      const title = `Perfect Entry: ${payload.snapshot.symbol}`;
      const body = `${payload.setup.direction} | Entry ${payload.setup.entry} | SL ${payload.setup.stopLoss} | TP ${payload.setup.takeProfit}`;
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [socket]);

  const emitWatchlist = () => {
    if (!autoAnalyze || !connected) {
      return;
    }

    socket.emit("market:watchlist", {
      items: favorites.slice(0, 3),
      tradeMode,
      risk: {
        accountBalance: balance,
        riskPercent
      }
    });
  };

  useEffect(() => {
    emitWatchlist();
  }, [favorites, balance, riskPercent, tradeMode, autoAnalyze, connected]);

  useEffect(() => {
    if (!connected || !autoAnalyze) {
      return;
    }

    socket.emit("market:subscribe", {
      market,
      symbol,
      timeframe,
      tradeMode,
      risk: {
        accountBalance: balance,
        riskPercent
      }
    });
  }, [connected, autoAnalyze, market, symbol, timeframe, tradeMode, balance, riskPercent, socket]);

  useEffect(() => {
    const loadJournal = () => {
      void getJournalStats().then(setStats).catch(() => undefined);
      void getRecentTrades().then(setRecentTrades).catch(() => undefined);
      void getAutomationStatus().then(setAutomation).catch(() => undefined);
    };

    loadJournal();
    const timer = setInterval(loadJournal, 8000);
    return () => clearInterval(timer);
  }, []);

  async function onStart() {
    setError(null);
    try {
      const first = await analyzeLive({
        market,
        symbol,
        timeframe,
        tradeMode,
        risk: {
          accountBalance: balance,
          riskPercent
        }
      });
      setResult(first);

      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }

      setAutoAnalyze(true);
      emitWatchlist();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const quickBreakdown = useMemo(() => {
    if (!result) {
      return [] as string[];
    }

    return [
      `${result.setup.appliedMode.toUpperCase()} mode on ${result.snapshot.timeframe}: ${result.setup.direction} bias (${result.setup.signalQuality})`,
      `Primary plan: Entry ${result.setup.entry}, SL ${result.setup.stopLoss}, TP ${result.setup.takeProfit}, RR 1:${result.setup.rr}`,
      result.setup.futureEntries.length > 0
        ? `Limit ladder ready with ${result.setup.futureEntries.length} levels for staged entries.`
        : "No limit ladder generated for current structure."
    ];
  }, [result]);

  const toolsSymbol = useMemo(() => {
    if (market === "forex") {
      return `FX:${symbol}`;
    }
    if (market === "crypto") {
      return `BINANCE:${symbol}`;
    }
    return symbol;
  }, [market, symbol]);

  function addCurrentToFavorites() {
    const item: FavoriteItem = { market, symbol, timeframe };
    const exists = favorites.some((f) => favKey(f) === favKey(item));
    if (exists) {
      return;
    }
    if (favorites.length >= 3) {
      setError("Maximum of 3 favorites allowed.");
      return;
    }
    setFavorites((prev) => [...prev, item]);
  }

  function removeFavorite(item: FavoriteItem) {
    setFavorites((prev) => prev.filter((f) => favKey(f) !== favKey(item)));
  }

  return (
    <div className="app-shell professional">
      <header className="hero">
        <h1>Live Market Analysis Terminal</h1>
        <p>Limit-first long-term planner with layered entries, structural stops, and target mapping.</p>
      </header>

      <main className="layout-terminal">
        <section className="card control-panel">
          <h2>Execution Controls</h2>
          <div className="status-row">
            <span className={`dot ${connected ? "on" : "off"}`} />
            <span>{connected ? "Live Connected" : "Disconnected"}</span>
          </div>

          <div className="grid two">
            <label>
              Market
              <select value={market} onChange={(e) => setMarket(e.target.value as MarketType)}>
                {MARKETS.map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Symbol
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {marketInstruments.map((item) => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.symbol} - {item.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Trade Style
              <select value={tradeMode} onChange={(e) => setTradeMode(e.target.value as TradeMode)}>
                {TRADE_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Timeframe
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as typeof timeframe)}>
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Account Balance
              <input
                type="number"
                min={100}
                value={balance}
                onChange={(e) => setBalance(Number(e.target.value))}
              />
            </label>
            <label>
              Risk %
              <input
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={riskPercent}
                onChange={(e) => setRiskPercent(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="fav-actions">
            <button type="button" onClick={addCurrentToFavorites}>
              Add Current Pair To Favorites
            </button>
            <p className="mini-note">Favorites: {favorites.length}/3</p>
          </div>

          {favorites.length > 0 && (
            <div className="favorite-list">
              {favorites.map((item) => (
                <button
                  className="chip"
                  key={favKey(item)}
                  type="button"
                  onClick={() => removeFavorite(item)}
                  title="Click to remove"
                >
                  {item.market.toUpperCase()} {item.symbol} {item.timeframe} x
                </button>
              ))}
            </div>
          )}

          <button type="button" onClick={onStart}>
            Run Analysis Now
          </button>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={(e) => setAutoAnalyze(e.target.checked)}
            />
            Always Analyze While Connected
          </label>

          {error && <p className="error">{error}</p>}
          <p className="notice">Use M1/M5 for scalping, M15/H1 for day trading, H4/D1 for swing or position.</p>
        </section>

        <section className="card chart-card">
          <h2>Live Price Action</h2>
          <div className="chart-actions">
            <button type="button" onClick={() => setChartExpanded(true)}>
              Enlarge Chart
            </button>
            <a
              className="tool-link"
              href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(toolsSymbol)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open Analysis Tools
            </a>
          </div>
          <LiveChart candles={result?.snapshot.candles ?? []} analysis={result?.setup ?? null} />
        </section>

        {result && (
          <section className="card breakdown-card">
            <h2>Latest Analysis Breakdown</h2>
            <ul>
              {quickBreakdown.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mini-note">Updated: {new Date(result.updatedAt).toLocaleString()}</p>
          </section>
        )}

        <section className="card watch-card">
          <h2>Favorites Watchlist Alerts</h2>
          {favorites.length === 0 ? (
            <p className="notice">Add up to 3 favorites to receive perfect-entry notifications.</p>
          ) : (
            <div className="watch-grid">
              {favorites.map((item) => {
                const key = favKey(item);
                const signal = watchSignals[key];

                return (
                  <div className="watch-item" key={key}>
                    <h3>
                      {item.symbol} ({item.market.toUpperCase()})
                    </h3>
                    {signal ? (
                      <>
                        <p className="label">Signal</p>
                        <p className={`value direction ${signal.setup.direction.toLowerCase()}`}>
                          {signal.setup.direction} - {signal.setup.signalQuality}
                        </p>
                        <p className="mini-note">
                          Entry {signal.setup.entry} | SL {signal.setup.stopLoss} | TP {signal.setup.takeProfit}
                        </p>
                      </>
                    ) : (
                      <p className="mini-note">Waiting for update...</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card journal-card">
          <h2>Trade Journal And Automation</h2>
          {automation && (
            <p className="mini-note">
              Auto Execution: {automation.enabled ? "Enabled" : "Disabled"} | Broker: {automation.broker}
            </p>
          )}
          {stats ? (
            <div className="grid two">
              <p className="mini-note">Total Trades: {stats.total}</p>
              <p className="mini-note">Open: {stats.open}</p>
              <p className="mini-note">Won: {stats.won}</p>
              <p className="mini-note">Lost: {stats.lost}</p>
              <p className="mini-note">Win Rate: {stats.winRate}%</p>
              <p className="mini-note">Total PnL: {stats.totalPnl}</p>
            </div>
          ) : (
            <p className="mini-note">Loading journal stats...</p>
          )}

          <h3>Recent Trades</h3>
          {recentTrades.length === 0 ? (
            <p className="mini-note">No trades recorded yet.</p>
          ) : (
            <div className="recent-trades">
              {recentTrades.map((trade) => (
                <div className="future-item" key={trade.id}>
                  <p className="label">
                    {trade.symbol} {trade.direction} {trade.status}
                  </p>
                  <p className="mini-note">
                    {trade.tradeMode.toUpperCase()} {trade.timeframe} | Entry {trade.entry} | SL {trade.stopLoss} | TP {trade.takeProfit}
                  </p>
                  <p className="mini-note">Source: {trade.source}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {result ? (
          <ResultCard result={result} />
        ) : (
          <section className="card empty">
            <h2>Awaiting Live Feed</h2>
            <p>Start live analysis to stream chart updates and setup levels.</p>
          </section>
        )}
      </main>

      {chartExpanded && (
        <div className="chart-modal" onClick={() => setChartExpanded(false)} role="presentation">
          <div className="chart-modal-content" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="chart-modal-head">
              <h2>Expanded Chart</h2>
              <button type="button" onClick={() => setChartExpanded(false)}>
                Close
              </button>
            </div>
            <LiveChart candles={result?.snapshot.candles ?? []} analysis={result?.setup ?? null} />
          </div>
        </div>
      )}
    </div>
  );
}
