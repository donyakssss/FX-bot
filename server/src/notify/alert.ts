export async function sendAlert(payload: { title: string; text: string; meta?: any }) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    // no alerting configured
    return false;
  }

  try {
    // Use global fetch if available (Node 18+), otherwise fail gracefully.
    const f = (globalThis as any).fetch;
    if (!f) return false;
    await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${payload.title}\n${payload.text}`, meta: payload.meta || {} })
    });
    return true;
  } catch (err) {
    console.error("Failed to send alert", err);
    return false;
  }
}

export default sendAlert;
