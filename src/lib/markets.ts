// Multi-market support: detect market from ticker suffix and expose currency,
// benchmark, exchange display name, flag emoji, and macro-context series IDs.
//
// US tickers have no suffix (AAPL). European tickers use the Yahoo /
// Polygon convention {SYMBOL}.{EXCHANGE_SUFFIX} (EDP.LS, ASML.AS, SAP.DE).

export type Market =
  | "US" | "PT" | "NL" | "FR" | "UK" | "DE" | "IT" | "ES" | "EU_OTHER";

export type Currency = "USD" | "EUR" | "GBP";

const SUFFIX_TO_MARKET: Record<string, Market> = {
  LS: "PT",   // Euronext Lisboa
  AS: "NL",   // Euronext Amsterdam
  PA: "FR",   // Euronext Paris
  L:  "UK",   // London Stock Exchange
  DE: "DE",   // Xetra Frankfurt
  F:  "DE",   // Frankfurt (alt)
  MI: "IT",   // Borsa Italiana
  MC: "ES",   // BME Madrid
  BR: "EU_OTHER", // Euronext Brussels
  VI: "EU_OTHER", // Wiener Börse
  HE: "EU_OTHER", // Helsinki
  ST: "EU_OTHER", // Stockholm
  CO: "EU_OTHER", // Copenhagen
  OL: "EU_OTHER", // Oslo
  SW: "EU_OTHER", // SIX Swiss
  IR: "EU_OTHER", // Euronext Dublin
};

export function detectMarket(ticker: string): Market {
  if (!ticker.includes(".")) return "US";
  const suffix = ticker.split(".").pop()?.toUpperCase() ?? "";
  return SUFFIX_TO_MARKET[suffix] ?? "EU_OTHER";
}

export const MARKET_CURRENCY: Record<Market, Currency> = {
  US: "USD", PT: "EUR", NL: "EUR", FR: "EUR", DE: "EUR",
  IT: "EUR", ES: "EUR", UK: "GBP", EU_OTHER: "EUR",
};

export const MARKET_FLAG: Record<Market, string> = {
  US: "🇺🇸", PT: "🇵🇹", NL: "🇳🇱", FR: "🇫🇷", DE: "🇩🇪",
  IT: "🇮🇹", ES: "🇪🇸", UK: "🇬🇧", EU_OTHER: "🇪🇺",
};

export const MARKET_EXCHANGE_NAME: Record<Market, string> = {
  US: "US Markets",
  PT: "Euronext Lisboa",
  NL: "Euronext Amsterdam",
  FR: "Euronext Paris",
  DE: "Xetra Frankfurt",
  IT: "Borsa Italiana",
  ES: "BME Madrid",
  UK: "London Stock Exchange",
  EU_OTHER: "European Exchange",
};

export const MARKET_BENCHMARK: Record<Market, { ticker: string; name: string }> = {
  US: { ticker: "SPY",      name: "S&P 500" },
  PT: { ticker: "PSI20",    name: "PSI-20" },
  NL: { ticker: "AEX",      name: "AEX" },
  FR: { ticker: "PX1",      name: "CAC 40" },
  UK: { ticker: "UKX",      name: "FTSE 100" },
  DE: { ticker: "DAX",      name: "DAX 40" },
  IT: { ticker: "FTSEMIB",  name: "FTSE MIB" },
  ES: { ticker: "IBEX",     name: "IBEX 35" },
  EU_OTHER: { ticker: "STOXX50E", name: "Euro Stoxx 50" },
};

// Sovereign benchmark for "10Y" rate label per market
export const MARKET_TENYEAR_LABEL: Record<Market, string> = {
  US: "10Y Treasury",
  PT: "10Y OT",
  NL: "10Y DSL",
  FR: "10Y OAT",
  DE: "10Y Bund",
  IT: "10Y BTP",
  ES: "10Y Bono",
  UK: "10Y Gilt",
  EU_OTHER: "10Y Bund",
};

// Central-bank short-rate label per currency
export const CURRENCY_POLICY_RATE_LABEL: Record<Currency, string> = {
  USD: "Fed Funds",
  EUR: "ECB Rate",
  GBP: "BoE Rate",
};

// Currency symbol/code prefix for monetary values
export const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$", EUR: "€", GBP: "£",
};

// FX series IDs from FRED (CSV graph endpoint)
// DEXUSEU: USD per EUR (e.g. 1.08) — use to convert EUR → USD multiply
// DEXUSUK: USD per GBP (e.g. 1.27) — use to convert GBP → USD multiply
export const FX_FRED_SERIES: Record<Currency, string | null> = {
  USD: null,
  EUR: "DEXUSEU",
  GBP: "DEXUSUK",
};

// Currency conversion: convert `amount` from `from` to `to` using fxRates.
// fxRates is keyed by currency code and stores USD per 1 unit of that currency.
export function convertCurrency(
  amount: number | null,
  from: Currency,
  to: Currency,
  fxRates: Partial<Record<Currency, number | null>>,
): number | null {
  if (amount == null || !isFinite(amount)) return null;
  if (from === to) return amount;
  const fromUsd = from === "USD" ? 1 : fxRates[from];
  const toUsd = to === "USD" ? 1 : fxRates[to];
  if (!fromUsd || !toUsd) return null;
  // amount in USD = amount * fromUsd; in `to` = / toUsd
  return (amount * fromUsd) / toUsd;
}

// EU sector medians for EV/EBITDA fair-value model. Generally lower than US.
export const SECTOR_MEDIANS_EUROPE: Record<string, number> = {
  Technology: 18,
  Healthcare: 14,
  Financials: 9,
  "Financial Services": 9,
  "Consumer Discretionary": 12,
  "Consumer Cyclical": 12,
  "Consumer Staples": 13,
  "Consumer Defensive": 13,
  Industrials: 12,
  Energy: 7,
  Materials: 9,
  "Basic Materials": 9,
  Utilities: 11,
  "Real Estate": 18,
  "Communication Services": 13,
};

// Polygon "locale" path component
export function polygonLocale(market: Market): "us" | "global" {
  return market === "US" ? "us" : "global";
}

// Ordered list of supported suffixes for the search-bar tooltip
export const SUPPORTED_SUFFIXES: { suffix: string; exchange: string; flag: string }[] = [
  { suffix: "(none)", exchange: "US Markets",         flag: "🇺🇸" },
  { suffix: ".LS",    exchange: "Euronext Lisboa",    flag: "🇵🇹" },
  { suffix: ".AS",    exchange: "Euronext Amsterdam", flag: "🇳🇱" },
  { suffix: ".PA",    exchange: "Euronext Paris",     flag: "🇫🇷" },
  { suffix: ".DE",    exchange: "Xetra Frankfurt",    flag: "🇩🇪" },
  { suffix: ".MI",    exchange: "Borsa Italiana",     flag: "🇮🇹" },
  { suffix: ".MC",    exchange: "BME Madrid",         flag: "🇪🇸" },
  { suffix: ".L",     exchange: "London Stock Exchange", flag: "🇬🇧" },
];