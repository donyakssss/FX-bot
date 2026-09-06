#!/usr/bin/env bash
# render_set_env_vars.sh
# Usage: RENDER_API_KEY=xxx SERVICE_ID=your-service-id ./render_set_env_vars.sh
# This script will PATCH Render service env vars. Review before running.

if [ -z "$RENDER_API_KEY" ] || [ -z "$SERVICE_ID" ]; then
  echo "Please set RENDER_API_KEY and SERVICE_ID environment variables before running."
  exit 1
fi

API_URL="https://api.render.com/v1/services/$SERVICE_ID/env"

# Build JSON payload. Edit values below as needed.
read -r -d '' PAYLOAD <<'JSON'
{
  "envVars": [
    {"key":"MT5_SHARED_SECRET","value":"replace_with_secret","secure":true},
    {"key":"ENABLE_AUTO_EXECUTION","value":"false","secure":false},
    {"key":"BROKER","value":"mt5","secure":false},
    {"key":"MT5_MIN_LOT","value":"0.01","secure":false},
    {"key":"MT5_MAX_LOT","value":"2","secure":false},
    {"key":"MT5_LOT_STEP","value":"0.01","secure":false},
    {"key":"MT5_SYMBOL_MAP_JSON","value":"{\"BTCUSD\":\"BTCUSDz\",\"ETHUSD\":\"ETHUSDz\"}","secure":false},
    {"key":"MAX_CONCURRENT_TRADES","value":"2","secure":false}
  ]
}
JSON

curl -s -X PATCH "$API_URL" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  | jq .

echo "If curl succeeded, env vars were updated. Set MT5_SHARED_SECRET to a secure value and update the payload accordingly." 
