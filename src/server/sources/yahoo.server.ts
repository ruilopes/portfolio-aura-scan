// Yahoo Finance source client. Server-side only.
// Handles the cookie+crumb authenticated quoteSummary endpoint plus the public
// chart and quote endpoints (which don't need a crumb).

import { getYahooAuth, clearYahooAuth, YAHOO_BROWSER_UA } from "../yahoo-auth.server";

const YAHOO = "https://query1.finance.yahoo.com";

// ─── Yahoo rate-limit guard ───────────────────────────────────────────────
// Once Yahoo returns a 429 from the Cloudflare Worker IP range, every
// subsequent request in this isolate is short-circuited until the user
// manually clicks "Retry Yahoo" (which calls resetYahooRateLimit()).
let yahooRateLimited = false;
export function isYahooRateLimited(): boolean {
  return yahooRateLimited;
}
export function resetYahooRateLimit(): void {
  yahooRateLimited = false;
  clearYahooAuth();
}

export type YahooBundle = {
  ok: boolean;
  // Raw quoteSummary modules
  price?: any;
  summaryDetail?: any;
  defaultKeyStatistics?: any;
  financialData?: any;
  assetProfile?: any;
  incomeStatementHistory?: any;
  incomeStatementHistoryQuarterly?: any;
  balanceSheetHistory?: any;
  balanceSheetHistoryQuarterly?: any;
  cashflowStatementHistory?: any;
  earningsTrend?: any;
  recommendationTrend?: any;
  upgradeDowngradeHistory?: any;
  institutionOwnership?: any;
  insiderHolders?: any;
  insiderTransactions?: any;
  calendarEvents?: any;
  esgScores?: any;
  secFilings?: any;
};

async function rawQuoteSummary(
  ticker: string,
  modules: string[],
  retry = true,
): Promise<any | null> {
  const auth = await getYahooAuth();
  const headers: Record<string, string> = {
    "User-Agent": YAHOO_BROWSER_UA,
    Accept: "application/json, text/plain, */*",
  };
  let url = `${YAHOO}/v10/finance/quoteSummary/${encodeURIComponent(
    ticker,
  )}?modules=${modules.join(",")}&corsDomain=finance.yahoo.com&formatted=true`;
  if (auth) {
    url += `&crumb=${encodeURIComponent(auth.crumb)}`;
    headers.Cookie = auth.cookie;
  }

  try {
    const res = await fetch(url, { headers });
    if (res.status === 401 || res.status === 403) {
      console.log(`[Yahoo] ${ticker} modules=${modules[0]}.. → ${res.status} (auth) retry=${retry}`);
      if (retry) {
        clearYahooAuth();
        return rawQuoteSummary(ticker, modules, false);
      }
      return null;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(
        `[Yahoo] ${ticker} modules=${modules[0]}.. → ${res.status} body[0..200]:`,
        body.slice(0, 200),
      );
      return null;
    }
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0] || null;
    const err = json?.quoteSummary?.error;
    if (!result) {
      console.log(
        `[Yahoo] ${ticker} modules=${modules[0]}.. → 200 but empty result, error:`,
        JSON.stringify(err)?.slice(0, 200),
      );
    }
    return result;
  } catch (e: any) {
    console.log(`[Yahoo] ${ticker} modules=${modules[0]}.. threw:`, e?.message);
    return null;
  }
}

export async function fetchYahooBundle(ticker: string): Promise<YahooBundle> {
  // Yahoo limits modules per request; split into 3 batches in parallel.
  const batchA = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "assetProfile",
  ];
  const batchB = [
    "incomeStatementHistory",
    "incomeStatementHistoryQuarterly",
    "balanceSheetHistory",
    "balanceSheetHistoryQuarterly",
    "cashflowStatementHistory",
    "earningsTrend",
  ];
  const batchC = [
    "recommendationTrend",
    "upgradeDowngradeHistory",
    "institutionOwnership",
    "insiderHolders",
    "insiderTransactions",
    "calendarEvents",
    "esgScores",
    "secFilings",
  ];
  const [a, b, c] = await Promise.allSettled([
    rawQuoteSummary(ticker, batchA),
    rawQuoteSummary(ticker, batchB),
    rawQuoteSummary(ticker, batchC),
  ]);
  const A = a.status === "fulfilled" ? a.value : null;
  const B = b.status === "fulfilled" ? b.value : null;
  const C = c.status === "fulfilled" ? c.value : null;
  return {
    ok: !!(A || B || C),
    ...(A || {}),
    ...(B || {}),
    ...(C || {}),
  };
}

export type YahooChart = {
  meta: any;
  series: { date: string; close: number; high: number; low: number; volume: number }[];
};

export async function fetchYahooChart(ticker: string): Promise<YahooChart | null> {
  if (yahooRateLimited) return null;
  try {
    const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(
      ticker,
    )}?interval=1d&range=1y`;
    const res = await fetch(url, {
      headers: { "User-Agent": YAHOO_BROWSER_UA, Accept: "application/json" },
    });
    if (res.status === 429) {
      yahooRateLimited = true;
      console.log(`[Yahoo Chart] ${ticker} → 429, demoting Yahoo for session`);
      return null;
    }
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const ts: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
    const highs: (number | null)[] = result.indicators?.quote?.[0]?.high || [];
    const lows: (number | null)[] = result.indicators?.quote?.[0]?.low || [];
    const vols: (number | null)[] = result.indicators?.quote?.[0]?.volume || [];
    const series = ts
      .map((t, i) => ({
        date: new Date(t * 1000).toISOString().slice(0, 10),
        close: closes[i],
        high: highs[i],
        low: lows[i],
        volume: vols[i],
      }))
      .filter((p) => p.close != null) as YahooChart["series"];
    return { meta: result.meta || {}, series };
  } catch {
    return null;
  }
}

// Yahoo's v7 quote endpoint also requires a crumb now. We use it as a price
// fallback only — the chart's last close gives us essentially the same number.
export async function fetchYahooRealtimePrice(ticker: string): Promise<number | null> {
  const auth = await getYahooAuth();
  if (!auth) return null;
  try {
    const url = `${YAHOO}/v7/finance/quote?symbols=${encodeURIComponent(
      ticker,
    )}&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": YAHOO_BROWSER_UA,
        Accept: "application/json",
        Cookie: auth.cookie,
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const price = json?.quoteResponse?.result?.[0]?.regularMarketPrice;
    return typeof price === "number" && isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

// Helpers shared across modules — Yahoo wraps numbers as { raw, fmt, longFmt }.
export const yRaw = (x: any): number | null => {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  if (typeof x === "object" && "raw" in x)
    return typeof x.raw === "number" && isFinite(x.raw) ? x.raw : null;
  return null;
};
export const yStr = (x: any): string | null => {
  if (x == null) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object" && "fmt" in x) return x.fmt;
  return null;
};
