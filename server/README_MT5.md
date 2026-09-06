MT5 Bridge — Deployment & Environment Variable Guide

This document explains recommended environment variables and quick steps to configure the server (local) and production (Render, similar PaaS).

1) Recommended env vars (example values)

- `MT5_SHARED_SECRET` — shared secret between EA and server. Example: `s3cr3t-LOCAL` (keep secret)
- `ENABLE_AUTO_EXECUTION` — `true` to allow server to execute orders automatically (use `false` until tested)
- `BROKER` — `mt5` (other options: `paper`, `binance`)
- `MT5_MIN_LOT` — `0.01`
- `MT5_MAX_LOT` — `2` (conservative default)
- `MT5_LOT_STEP` — `0.01`
- `MT5_SYMBOL_MAP_JSON` — single-line JSON mapping for broker-specific symbol names. Example: `{"BTCUSD":"BTCUSDz","ETHUSD":"ETHUSDz"}`
- `MAX_CONCURRENT_TRADES` — `2`
- `ALERT_WEBHOOK_URL` — optional webhook for order/alert notifications

2) Local testing (PowerShell)

Set environment variables and start the server locally:

```powershell
Set-Location -LiteralPath "C:\Users\ayuba\OneDrive\Desktop\fx bot\server"
$env:MT5_SHARED_SECRET = "localtestsecret"
$env:ENABLE_AUTO_EXECUTION = "true"
$env:BROKER = "mt5"
$env:MT5_MIN_LOT = "0.01"
$env:MT5_MAX_LOT = "2"
$env:MT5_LOT_STEP = "0.01"
npm run dev
```

In MT5 Terminal (Tools → Options → Expert Advisors) add `http://localhost:4000` to "Allow WebRequest for listed URL" and set the EA `BridgeBaseUrl` to `http://localhost:4000` and `SharedSecret` to the same secret.

3) Deploying to Render (or similar)

- Use your service's environment variables UI to add the above keys.
- Example `render.yaml` snippet (for reference):

```yaml
services:
  - type: web
    name: fx-bot-server
    env: node
    plan: free
    envVars:
      - key: MT5_SHARED_SECRET
        value: "your-prod-secret"
      - key: ENABLE_AUTO_EXECUTION
        value: "false"
      - key: BROKER
        value: "mt5"
      - key: MT5_MIN_LOT
        value: "0.01"
      - key: MT5_MAX_LOT
        value: "2"
      - key: MT5_LOT_STEP
        value: "0.01"
      - key: MT5_SYMBOL_MAP_JSON
        value: '{"BTCUSD":"BTCUSDz","ETHUSD":"ETHUSDz"}'
```

4) Notes & troubleshooting

- Ensure `MT5_SHARED_SECRET` matches the EA `SharedSecret` input.
- Allow the Bridge URL in MT5 Tools → Options → Expert Advisors → Allow WebRequest for listed URL.
- If the EA reports `Terminal is offline` or `OrderSend` errors, verify AutoTrading and Expert Advisors are enabled and that the account is connected.
- Check symbol mapping: many brokers append suffixes (z,A,B). Use `MT5_SYMBOL_MAP_JSON` or prefix/suffix envs to map.
- If orders are rejected due to lot size, adjust `MT5_MAX_LOT` and `MT5_LOT_STEP` to your broker contract rules.

5) Quick commands (bash)

```bash
# export and run locally
export MT5_SHARED_SECRET=localtestsecret
export ENABLE_AUTO_EXECUTION=true
export BROKER=mt5
npm run dev
```

If you'd like, I can prepare a small Render CLI script you can run locally to upload these env vars to your service — tell me your Render service name and I'll generate it.
