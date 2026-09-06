export type RuntimeConfig = {
  enableAutoExecution: boolean;
};

const cfg: RuntimeConfig = {
  enableAutoExecution: process.env.ENABLE_AUTO_EXECUTION === "true"
};

export function getRuntimeConfig(): RuntimeConfig {
  return { ...cfg };
}

export function setRuntimeConfig(next: Partial<RuntimeConfig>) {
  if (typeof next.enableAutoExecution === "boolean") cfg.enableAutoExecution = next.enableAutoExecution;
  return getRuntimeConfig();
}

export default cfg;
