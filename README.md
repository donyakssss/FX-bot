# FX ICT Live Market Terminal

A full-stack multi-market analysis platform with:
- ICT mentorship-inspired SMC + CRT structure analysis
- Live market feeds for forex, crypto, indices, metals, and synthetics
- Live charting and streaming setup updates (entry, stop loss, take profit)
- Risk management: fixed-% risk and dynamic lot-size estimation
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

### Automation And MT5 Bridge
- `GET /api/automation/status`
- `GET /api/mt5/orders/pending` (secured with `x-mt5-secret` when `MT5_SHARED_SECRET` is set)
- `GET /api/mt5/trailing-rules` (server-defined trailing profiles)
- `POST /api/mt5/orders/ack` body: `{ "id": "...", "status": "FILLED" | "REJECTED", "ticket": "...", "note": "..." }`

### `POST /api/analyze`
Legacy manual-candles endpoint for custom feeds/testing.

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
     - `MT5_SYMBOL_PREFIX` (e.g. `m`)
     - `MT5_SYMBOL_SUFFIX` (e.g. `.a`)
     - `MT5_SYMBOL_MAP_JSON` (explicit overrides, example: `{"XAUUSD":"GOLD"}`)
3. Restart backend server
4. Verify with `GET /api/automation/status`

### MT5 EA integration flow
1. EA polls `GET /api/mt5/orders/pending`
2. EA places pending order in MT5 using received `brokerSymbol`, `entry`, `stopLoss`, `takeProfit`, `lotSize`
3. EA confirms with `POST /api/mt5/orders/ack`

### Reliability safeguards now included
- Duplicate protection with persistent `signalHash` in queue storage
- MT5 ticket conflict protection in ack flow
- Server-defined trailing rules attached to each queued order (`breakEvenR`, `trailStartR`, `trailStepR`)

### MT5 template included
- EA file: `mt5/FxBotBridgeEA.mq5`
- Copy this file into your MT5 `MQL5/Experts` folder, compile in MetaEditor, then attach to a chart.
- In MT5: `Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL`, add your bridge URL (for local: `http://127.0.0.1:4000`).
- Set EA inputs:
   - `BridgeBaseUrl`
   - `SharedSecret` (must match `MT5_SHARED_SECRET`)
   - `PollIntervalSec`
