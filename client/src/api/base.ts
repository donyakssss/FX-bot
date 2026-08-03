const LOCAL_API_BASE = "http://localhost:4000";

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, "");

export const resolveApiBase = (): string => {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) {
    return stripTrailingSlash(configured);
  }

  if (typeof window === "undefined") {
    return LOCAL_API_BASE;
  }

  const { hostname, origin, port } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1" || port === "5173") {
    return LOCAL_API_BASE;
  }

  return origin;
};