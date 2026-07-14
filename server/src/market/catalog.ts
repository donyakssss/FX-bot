import type { Instrument } from "../types/market.js";

export const INSTRUMENTS: Instrument[] = [
  { market: "forex", symbol: "EURUSD", displayName: "EUR/USD", providerSymbol: "EURUSD=X" },
  { market: "forex", symbol: "GBPUSD", displayName: "GBP/USD", providerSymbol: "GBPUSD=X" },
  { market: "forex", symbol: "USDJPY", displayName: "USD/JPY", providerSymbol: "USDJPY=X" },
  { market: "forex", symbol: "USDCHF", displayName: "USD/CHF", providerSymbol: "USDCHF=X" },
  { market: "forex", symbol: "AUDUSD", displayName: "AUD/USD", providerSymbol: "AUDUSD=X" },
  { market: "forex", symbol: "USDCAD", displayName: "USD/CAD", providerSymbol: "USDCAD=X" },
  { market: "forex", symbol: "NZDUSD", displayName: "NZD/USD", providerSymbol: "NZDUSD=X" },
  { market: "forex", symbol: "EURJPY", displayName: "EUR/JPY", providerSymbol: "EURJPY=X" },
  { market: "forex", symbol: "GBPJPY", displayName: "GBP/JPY", providerSymbol: "GBPJPY=X" },
  { market: "forex", symbol: "EURGBP", displayName: "EUR/GBP", providerSymbol: "EURGBP=X" },

  { market: "crypto", symbol: "BTCUSDT", displayName: "Bitcoin / Tether", providerSymbol: "BTCUSDT" },
  { market: "crypto", symbol: "ETHUSDT", displayName: "Ethereum / Tether", providerSymbol: "ETHUSDT" },
  { market: "crypto", symbol: "BNBUSDT", displayName: "BNB / Tether", providerSymbol: "BNBUSDT" },
  { market: "crypto", symbol: "SOLUSDT", displayName: "Solana / Tether", providerSymbol: "SOLUSDT" },
  { market: "crypto", symbol: "XRPUSDT", displayName: "XRP / Tether", providerSymbol: "XRPUSDT" },

  { market: "indices", symbol: "US500", displayName: "S&P 500", providerSymbol: "^GSPC" },
  { market: "indices", symbol: "US100", displayName: "Nasdaq 100", providerSymbol: "^NDX" },
  { market: "indices", symbol: "US30", displayName: "Dow 30", providerSymbol: "^DJI" },
  { market: "indices", symbol: "GER40", displayName: "DAX", providerSymbol: "^GDAXI" },
  { market: "indices", symbol: "UK100", displayName: "FTSE 100", providerSymbol: "^FTSE" },

  { market: "metals", symbol: "XAUUSD", displayName: "Gold", providerSymbol: "GC=F" },
  { market: "metals", symbol: "XAGUSD", displayName: "Silver", providerSymbol: "SI=F" },

  { market: "synthetics", symbol: "R_100", displayName: "Volatility 100 Index", providerSymbol: "R_100" },
  { market: "synthetics", symbol: "R_75", displayName: "Volatility 75 Index", providerSymbol: "R_75" },
  { market: "synthetics", symbol: "R_50", displayName: "Volatility 50 Index", providerSymbol: "R_50" }
];

export const findInstrument = (market: string, symbol: string): Instrument | undefined =>
  INSTRUMENTS.find((i) => i.market === market && i.symbol.toUpperCase() === symbol.toUpperCase());
