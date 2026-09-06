export type RuntimeConfig = {
  enableAutoExecution: boolean;
};

import fs from "fs";
import path from "path";

const RUNTIME_FILE = path.resolve(process.cwd(), ".runtime.json");

function readFromFile(): Partial<RuntimeConfig> {
  try {
    if (!fs.existsSync(RUNTIME_FILE)) return {};
    const raw = fs.readFileSync(RUNTIME_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    console.warn("Failed to read runtime config:", (e as any).message || e);
    return {};
  }
}

function writeToFile(obj: Partial<RuntimeConfig>) {
  try {
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.warn("Failed to write runtime config:", (e as any).message || e);
  }
}

const fileCfg = readFromFile();

const cfg: RuntimeConfig = {
  enableAutoExecution: fileCfg.enableAutoExecution ?? process.env.ENABLE_AUTO_EXECUTION === "true"
};

export function getRuntimeConfig(): RuntimeConfig {
  return { ...cfg };
}

export function setRuntimeConfig(next: Partial<RuntimeConfig>) {
  if (typeof next.enableAutoExecution === "boolean") cfg.enableAutoExecution = next.enableAutoExecution;
  // persist
  writeToFile(getRuntimeConfig());
  return getRuntimeConfig();
}

export default cfg;
