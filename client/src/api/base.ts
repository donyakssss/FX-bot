const LOCAL_API_BASE = "http://localhost:4000";
const DEFAULT_RENDER_API_BASE = "http://147.15.143.184:4000";

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, "");

export const resolveApiBase = (): string => {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    return stripTrailingSlash(configured);
  }

  if (typeof window === "undefined") {
    return DEFAULT_RENDER_API_BASE;
  }

  const { hostname, origin, port } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1" || port === "5173") {
    return LOCAL_API_BASE;
  }

  return DEFAULT_RENDER_API_BASE;
};