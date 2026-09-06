import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS) || 5000;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000';
const SECRET = process.env.MT5_SHARED_SECRET || 'localtestsecret';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ordersFile = path.resolve(__dirname, '..', '..', 'data', 'mt5-orders.json');

let lastPendingIds = new Set<string>();

async function fetchPending() {
  try {
    const res = await fetch(`${SERVER_URL}/api/mt5/orders/pending`, {
      method: 'GET',
      headers: { 'x-mt5-secret': SECRET }
    });
    if (!res.ok) {
      console.log('[pending] HTTP', res.status);
      return;
    }
    const body = await res.json();
    const ids: Set<string> = new Set((body.orders || []).map((o: any) => String(o.id)));
    for (const id of ids) {
      if (!lastPendingIds.has(id)) {
        console.log(new Date().toISOString(), 'NEW PENDING', id);
      }
    }
    for (const id of lastPendingIds) {
      if (!ids.has(id)) console.log(new Date().toISOString(), 'PENDING CLEARED', id);
    }
    lastPendingIds = ids;
  } catch (e) {
    console.log('[pending] fetch error', (e as any).message || e);
  }
}

function tailOrdersFile() {
  try {
    if (!fs.existsSync(ordersFile)) return;
    const content = fs.readFileSync(ordersFile, 'utf8');
    console.log('ORDERS FILE SNAPSHOT:', content.slice(0, 2000));
  } catch (e) {
    console.log('[tail] error', (e as any).message || e);
  }
}

async function loop() {
  console.log('monitor started', { SERVER_URL, POLL_INTERVAL });
  tailOrdersFile();
  await fetchPending();
  setInterval(async () => {
    await fetchPending();
    tailOrdersFile();
  }, POLL_INTERVAL);
}

loop();
