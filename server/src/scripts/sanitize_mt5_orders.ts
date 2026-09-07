import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const filePath = join(process.cwd(), "data", "mt5-orders.json");

const minLot = Number(process.env.MT5_MIN_LOT ?? 0.01);
const maxLot = Number(process.env.MT5_MAX_LOT ?? 1000);
const lotStep = Number(process.env.MT5_LOT_STEP ?? 0.01);

const roundToStep = (value: number, step: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.max(0, Math.floor(value / step) * step);
};

const sanitize = () => {
  const raw = readFileSync(filePath, 'utf8');
  const orders = JSON.parse(raw) as any[];
  let changed = false;

  for (const o of orders) {
    if (o && (o.status === 'PENDING' || o.status === 'PROCESSING')) {
      const adjusted = Math.max(minLot, Math.min(maxLot, roundToStep(o.lotSize, lotStep)));
      if (adjusted !== o.lotSize) {
        o.note = (o.note ?? '') + (o.note ? ' | ' : '') + `Sanitized lot ${o.lotSize} -> ${adjusted}`;
        o.lotSize = adjusted;
        changed = true;
        console.log('Sanitized order', o.id, 'lot ->', adjusted);
      }
    }
  }

  if (changed) {
    writeFileSync(filePath, JSON.stringify(orders, null, 2), 'utf8');
    console.log('mt5-orders.json updated');
  } else {
    console.log('No changes needed');
  }
};

void sanitize();
