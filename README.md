## Pushing changes and deploying to Render
I can't push for you from this environment. To push the changes I made and trigger Render to deploy, run these commands from your repo root:

```bash
git add .
git commit -m "Add Malaysian SNR strategy, annotations, MT5 queuing, dry-run and CI"
git push origin main
```

Once pushed, Render will pick up the `render.yaml` configuration and deploy both services (API and web). Verify the API with:

```bash
curl https://<your-render-api-url>/api/health
```

Make sure to set secrets in the Render dashboard (MT5_SHARED_SECRET, BINANCE_API_KEY, BINANCE_API_SECRET) and any optional envs like `MAX_CONCURRENT_TRADES`.

### After deploy checklist
- Check `GET /api/automation/status` to ensure background settings.
- Run a dry-run from the UI or `POST /api/analyze-live` with `execution.dryRun=true` to validate execution output.
- If you use MT5, attach the EA and verify `GET /api/mt5/orders/pending` shows queued orders.
# FX ICT Live Market Terminal

A full-stack multi-market analysis platform with:
- ICT mentorship-inspired SMC + CRT structure analysis
- Adaptive strategy updates on each cycle with market-shift scoring
- Fundamental/news context ingestion for execution biasing
- Live market feeds for forex, crypto, indices, metals, and synthetics
- Live charting and streaming setup updates (entry, stop loss, take profit)
- Risk management: fixed-% risk and dynamic lot-size estimation
- One-tap market entry support for MT5 queue execution
- Reasonable trailing profiles with SL-to-breakeven behavior when in profit
- Auto-execution gating that can require significant market shifts
- Responsive web terminal for desktop/mobile
- Interactive chart overlays for entry, stop loss, take profit, and future limit entries
- Favorites watchlist (maximum 3 instruments) with perfect-entry notifications

## Important note
No strategy can guarantee 98% or 100% accuracy in live markets. This system is professional-grade in structure but still probabilistic and should be validated on demo before live execution.

## Tech stack
- Backend: Node.js, TypeScript, Express
- Frontend: React, TypeScript, Vite

## Project structure
- `server/` API + strategy engine + risk module
- `client/` web dashboard

## Run locally
1. Install dependencies:
   - `npm run install:all`
2. Start backend (terminal 1):
   - `npm run dev:server`
3. Start frontend (terminal 2):
   - `npm run dev:client`
4. Open frontend at:
   - `http://localhost:5173`

## Deploy without local server

### Option 1: Railway (API)
1. Push this repository to GitHub.
2. In Railway: New Project -> Deploy from GitHub repo.
3. Railway will use `railway.json` automatically.
4. Set environment variables in Railway service:
   - `ENABLE_AUTO_EXECUTION=true`
   - `BROKER=mt5`
   - `MT5_SHARED_SECRET=your_strong_secret`
   - Optional mapping: `MT5_SYMBOL_PREFIX`, `MT5_SYMBOL_SUFFIX`, `MT5_SYMBOL_MAP_JSON`
5. Deploy and copy your public API URL.
6. Verify:
   - `https://your-api-url/api/health`
   - `https://your-api-url/api/automation/status`

### Option 2: Render (API)
1. Push this repository to GitHub.
2. In Render: New -> Blueprint -> select this repo.
3. Render uses `render.yaml` and creates `fx-bot-api`.
4. Set secret values (especially `MT5_SHARED_SECRET`) in Render dashboard.
5. Deploy and verify the same health endpoints above.

### Option 3: Render (Web page)
1. The same blueprint also creates the frontend static site `fx-bot-web`.
2. After deploy, open the web service URL Render gives you for `fx-bot-web`.
3. That is the browser page for charts, signals, and controls.

### Frontend to cloud API
If frontend is local, create `client/.env` from `client/.env.example` and set:
- `VITE_API_URL=https://your-api-url`

If frontend is deployed, set the same variable in your frontend host environment.

## Live Data Providers
- Crypto: Binance public market API
- Forex, indices, metals: Yahoo Finance chart API
- Synthetics: Deriv public websocket feed

## API
### `GET /api/instruments`
Returns all instrument coverage by market class.

### `GET /api/market/candles`
Query params:
- `market` = forex | crypto | indices | metals | synthetics
- `symbol` = symbol from instrument list
- `timeframe` = M5 | M15 | M30 | H1 | H4 | D1
- `limit` = candles to return

### `POST /api/analyze-live`
Runs ICT-inspired analysis on live market data.

### Journal APIs
- `GET /api/journal/stats`
- `GET /api/journal/trades`
- `POST /api/journal/reset`

### Fundamentals And Economic Calendar APIs
- `GET /api/fundamentals/calendar?market=forex&symbol=EURUSD&horizonHours=24`
- `GET /api/fundamentals/news-block?market=forex&symbol=EURUSD`

### Automation And MT5 Bridge
- `GET /api/automation/status`
- `GET /api/mt5/orders/pending` (secured with `x-mt5-secret` when `MT5_SHARED_SECRET` is set)
- `GET /api/mt5/trailing-rules` (server-defined trailing profiles)
- `POST /api/mt5/orders/ack` body: `{ "id": "...", "status": "FILLED" | "REJECTED", "ticket": "...", "note": "..." }`

### `POST /api/analyze`
Legacy manual-candles endpoint for custom feeds/testing.

### `POST /api/annotations`
Generates a visual overlay with candlesticks and annotated support/resistance/entry/SL/TP markers.
- Query param `format=svg` (default) or `format=png` to request raster PNG (server uses `sharp` if installed).
- Body: same shape as `/api/analyze` (include `strategy: "malaysian-snr"` to use the Malaysian SNR strategy).

Example SVG:
```bash
curl -s -X POST http://localhost:4000/api/annotations \
   -H "Content-Type: application/json" \
   -d '{ "pair":"EURUSD", "timeframe":"M15", "tradeMode":"day", "strategy":"malaysian-snr", "candles":[ /* >=20 candles */ ], "risk":{"accountBalance":10000,"riskPercent":5} }' > overlay.svg
```

Example PNG:
```bash
curl -s -X POST 'http://localhost:4000/api/annotations?format=png' \
   -H "Content-Type: application/json" \
   -d '{ "pair":"EURUSD", "timeframe":"M15", "tradeMode":"day", "strategy":"malaysian-snr", "candles":[ /* >=20 candles */ ], "risk":{"accountBalance":10000,"riskPercent":5} }' > overlay.png
```

### Socket Events
- Client -> Server: `market:subscribe`
- Client -> Server: `market:watchlist`
- Server -> Client: `market:update`, `market:error`
- Server -> Client: `watch:update`, `watch:error`, `watch:perfect-entry`

`market:update` streams approximately every 5 seconds with refreshed candles and setup metrics.

### `POST /api/analyze` example
Body example:
```json
{
  "pair": "EURUSD",
  "timeframe": "M15",
  "candles": [
    { "time": "2026-07-11T10:00:00Z", "open": 1.089, "high": 1.0901, "low": 1.0887, "close": 1.0898 }
  ],
  "risk": { "accountBalance": 5000, "riskPercent": 1 },
  "quoteCurrency": "USD"
}
```

## ICT/SMC/CRT Strategy notes
- Market structure direction (HH/HL or LH/LL)
- Order block approximation for pullback entries
- CRT displacement and range-transition checks
- Dynamic RR target generation
- Risk engine guards:
   - Max risk input guard (0-5%)
   - Pip-based stop distance
   - Position sizing and execution warnings

## Suggested improvements
- Connect to broker or market data APIs
- Add backtesting and walk-forward validation
- Add session filters (London/NY), spread filter, and news filter
- Add persistent trade journal and analytics

## Auto Execution Setup
1. Copy `server/.env.example` to `server/.env`
2. Set:
   - `ENABLE_AUTO_EXECUTION=true`
   - `BROKER=paper` (safe test), `BROKER=binance` (crypto execution), or `BROKER=mt5` (MT5 bridge queue)
   - If using MT5 bridge, set `MT5_SHARED_SECRET` and send same value in MT5 EA `x-mt5-secret` header
   - Optional MT5 symbol normalization:
       - Leave `MT5_SYMBOL_PREFIX` and `MT5_SYMBOL_SUFFIX` empty for normal auto-detection
       - Use `MT5_SYMBOL_MAP_JSON` only for special broker symbol overrides (example: `{"XAUUSD":"GOLD"}`)
3. Restart backend server
4. Verify with `GET /api/automation/status`

### Trade all supported symbols automatically
If you want background auto-trading across all supported instruments (not just one pair), set:
- `BACKGROUND_AUTOTRADE_ENABLED=true`
- `BACKGROUND_ALL_SYMBOLS=true`
- `BACKGROUND_MARKETS=forex,crypto,indices,metals` (optional; defaults to these when BROKER=mt5)
- `BACKGROUND_TIMEFRAME=M15`
- `BACKGROUND_TRADE_MODE=day`

`BACKGROUND_ALL_SYMBOLS=true` takes priority over `BACKGROUND_SYMBOL` and `BACKGROUND_SYMBOLS`.

### MT5 EA integration flow
1. EA polls `GET /api/mt5/orders/pending`
2. EA auto-detects the broker symbol from Market Watch, then places either market or pending orders (based on queued `orderType`) using resolved symbol, `entry`, `stopLoss`, `takeProfit`, `lotSize`
3. EA confirms with `POST /api/mt5/orders/ack`

### Reliability safeguards now included
- Duplicate protection with persistent `signalHash` in queue storage
- MT5 ticket conflict protection in ack flow
- Server-defined trailing rules attached to each queued order (`breakEvenR`, `trailStartR`, `trailStepR`)
- Significant market-shift filter can block entries until structural expansion appears
- Fundamentals/news snapshot is attached to setup output and influences confidence

### New execution preference defaults
- `ONE_TAP_ENTRY_DEFAULT=true`
- `SIGNIFICANT_SHIFT_ONLY_DEFAULT=true`
- `ENABLE_TRAILING_DEFAULT=true`
- `MOVE_SL_TO_BREAKEVEN_DEFAULT=true`

### Dry-run / simulated execution
To simulate auto-execution without queuing orders, use the `dryRun` execution preference (boolean). A dry-run returns a summary of the orders that would have been queued but does not persist them.

Example (dry-run script):
```bash
cd server
npm run dry-run
```
This runs a small script that requests analysis and performs a dry-run execution using sample candles. Useful for validation before enabling `ENABLE_AUTO_EXECUTION=true`.

### Safety, limits and recommended defaults
The system aims to be flexible, but trading automation can produce large losses if misconfigured. These are recommended safety settings and limits to use in production:

- **Minimum risk per trade:** 5% (enforced by server validation). Change only if you fully understand the consequences.
- **Default auto-execution:** `ENABLE_AUTO_EXECUTION=false` for initial testing. Use `paper` broker for live testing.
- **Max concurrent exposure:** The system allows unlimited concurrent trades by default; set an operational cap by adding an environment variable `MAX_CONCURRENT_TRADES` and enforcing it in your EA or orchestration if you want limits.
- **One-tap vs layered orders:** `ONE_TAP_ENTRY_DEFAULT=true` enables immediate market entries; use layered (`oneTapEntry=false`) when you prefer entry at S/R retrace levels.
- **Trailing & breakeven:** `ENABLE_TRAILING_DEFAULT=true` and `MOVE_SL_TO_BREAKEVEN_DEFAULT=true` are recommended to reduce drawdown once positions move favorably.
- **News & fundamental blocking:** Keep `ECONOMIC_NEWS_BLOCK_ENABLED=true` and adjust pre/post minutes to avoid high-impact windows.

Start with these conservative settings for demo trading and gradually tune: `ENABLE_AUTO_EXECUTION=false`, `BROKER=paper`, `BACKGROUND_AUTOTRADE_ENABLED=false`, `ONE_TAP_ENTRY_DEFAULT=false`, and `ENABLE_TRAILING_DEFAULT=true`.

### Red-news protection settings
- `ECONOMIC_NEWS_BLOCK_ENABLED=true`
- `ECONOMIC_NEWS_PRE_MIN=20`
- `ECONOMIC_NEWS_POST_MIN=35`
- `ECONOMIC_CALENDAR_URL=https://nfs.faireconomy.media/ff_calendar_thisweek.xml`

These can be overridden per live socket subscription or analyze-live request using the `execution` object.

### MT5 template included
- EA file: `mt5/FxBotBridgeEA.mq5`
- Copy this file into your MT5 `MQL5/Experts` folder, compile in MetaEditor, then attach to a chart.
- In MT5: `Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL`, add your bridge URL (for Render: `https://fx-bot-api.onrender.com`).
- Set EA inputs:
   - `BridgeBaseUrl`
   - `SharedSecret` (must match `MT5_SHARED_SECRET`)
   - `PollIntervalSec`
