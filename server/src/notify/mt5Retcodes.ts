export const MT5_RETCODE_MESSAGES: Record<string, string> = {
  // best-effort friendly explanations; expand as you see specific EA logs
  "1001": "WebRequest transport/protocol error — check URL allowlist and TLS/HTTP settings.",
  "1003": "WebRequest GET transport/protocol status — webserver may be unreachable or TLS/protocol mismatch.",
  "10011": "Order send common error — verify terminal is online, symbol mapping, and lot size rules.",
  "10036": "Trailing modify failed — position may be closed or modify parameters invalid.",
  "4756": "Broker-specific error reported by EA — check order parameters and broker logs."
};

export function explainMt5Retcode(code?: string | number, note?: string) {
  if (!code) return note ?? "No retcode provided.";
  const key = String(code);
  const msg = MT5_RETCODE_MESSAGES[key];
  return msg ? `${msg} ${note ?? ""}` : `${note ?? "EA returned retcode:"} ${key}`;
}

export default MT5_RETCODE_MESSAGES;
