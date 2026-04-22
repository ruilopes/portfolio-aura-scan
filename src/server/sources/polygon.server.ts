// Polygon.io source client. Server-side only.
// Defensive design: free-tier plans return 401/403 on premium endpoints and
// 429 when the 5-req/min limit is hit. We catch all of those, mark the
// endpoint as "unavailable" for this request, and let the waterfall fall back
// to Tiingo / SEC / Yahoo.
//
// vX endpoints (financials, splits) are tried first; on 404 we fall back to
// a probed v3 path so the client keeps working when Polygon GA-promotes them.

const POLY = "https://api.polygon.io";

export type PolygonBundle = {
  ok: boolean;
  hasKey: boolean;
  rateLimited: boolean;
  unauthorized: boolean; // 401/403 — usually free-tier blocked endpoint
  ticker?: any; // /v3/reference/tickers/{T}
  snapshot?: any; // /v2/snapshot/.../tickers/{T}
  aggs?: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  spyAggs?: { date: string; close: number }[]; // for beta calculation
  sma50?: number | null;
  sma200?: number | null;
  rsi14?: number | null;
  macd?: { value: number; signal: number; histogram: number } | null;
  financials?: any[]; // last 4 annual or quarterly
  financialsQuarterly?: any[];
  news?: any[];
  dividends?: any[];
  trades?: any; // latest trade
};

type FetchResult<T> = {
  data: T | null;
  status: number;
  rateLimited: boolean;
  unauthorized: boolean;
};

async function pgFetch<T = any>(path: string, apiKey: string): Promise<FetchResult<T>> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${POLY}${path}${sep}apiKey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "StockAnalysisDashboard/1.0" },
    });
    if (res.status === 429) {
      console.log(`[Polygon] ${path} → 429 rate-limited`);
      return { data: null, status: 429, rateLimited: true, unauthorized: false };
    }
    if (res.status === 401 || res.status === 403) {
      console.log(`[Polygon] ${path} → ${res.status} not authorized (free-tier?)`);
      return { data: null, status: res.status, rateLimited: false, unauthorized: true };
    }
    if (!res.ok) {
      console.log(`[Polygon] ${path} → ${res.status}`);
      return { data: null, status: res.status, rateLimited: false, unauthorized: false };
    }
    const json = (await res.json()) as any;
    if (json?.status === "ERROR" || json?.error) {
      const msg = String(json?.error || json?.message || "").toLowerCase();
      if (msg.includes("not authorized") || msg.includes("upgrade") || msg.includes("subscribe")) {
        return { data: null, status: 200, rateLimited: false, unauthorized: true };
      }
      return { data: null, status: 200, rateLimited: false, unauthorized: false };
    }
    return { data: json as T, status: 200, rateLimited: false, unauthorized: false };
  } catch (e: any) {
    console.log(`[Polygon] ${path} threw: ${e?.message}`);
    return { data: null, status: 0, rateLimited: false, unauthorized: false };
  }
}

// vX → v3 fallback probe (used for financials & splits).
async function pgFetchVx<T = any>(
  pathVx: string,
  pathV3: string,
  apiKey: string,
): Promise<FetchResult<T>> {
  const r1 = await pgFetch<T>(pathVx, apiKey);
  if (r1.status === 404) return pgFetch<T>(pathV3, apiKey);
  return r1;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchPolygonBundle(
  ticker: string,
  opts: { locale?: "us" | "global" } = {},
): Promise<PolygonBundle> {
  const apiKey = (process.env.POLYGON_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, hasKey: false, rateLimited: false, unauthorized: false };
  }

  const t = encodeURIComponent(ticker);
  const locale = opts.locale ?? "us";
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const from = ymd(oneYearAgo);
  const to = ymd(today);

  // Fan out all calls in parallel. Free tier: most calls will 429/403 — that's
  // OK, the bundle just reports `ok: false` for that field and the waterfall
  // falls back to Tiingo/SEC.
  const calls = await Promise.allSettled([
    pgFetch(`/v3/reference/tickers/${t}`, apiKey), // 0 ticker
    pgFetch(`/v2/snapshot/locale/${locale}/markets/stocks/tickers/${t}`, apiKey), // 1 snapshot
    pgFetch(`/v2/aggs/ticker/${t}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=400`, apiKey), // 2 aggs
    pgFetch(`/v1/indicators/sma/${t}?timespan=day&window=50&series_type=close&limit=1`, apiKey), // 3 sma50
    pgFetch(`/v1/indicators/sma/${t}?timespan=day&window=200&series_type=close&limit=1`, apiKey), // 4 sma200
    pgFetch(`/v1/indicators/rsi/${t}?timespan=day&window=14&series_type=close&limit=1`, apiKey), // 5 rsi
    pgFetch(`/v1/indicators/macd/${t}?timespan=day&series_type=close&limit=1`, apiKey), // 6 macd
    pgFetchVx(`/vX/reference/financials?ticker=${t}&limit=4`, `/v3/reference/financials?ticker=${t}&limit=4`, apiKey), // 7 financials annual
    pgFetchVx(
      `/vX/reference/financials?ticker=${t}&timeframe=quarterly&limit=8`,
      `/v3/reference/financials?ticker=${t}&timeframe=quarterly&limit=8`,
      apiKey,
    ), // 8 financials quarterly
    pgFetch(`/v2/reference/news?ticker=${t}&limit=10`, apiKey), // 9 news
    pgFetch(`/v3/reference/dividends?ticker=${t}&limit=4`, apiKey), // 10 dividends
    pgFetch(`/v3/trades/${t}?limit=1`, apiKey), // 11 latest trade
    pgFetch(`/v2/aggs/ticker/SPY/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=400`, apiKey), // 12 SPY aggs (beta)
  ]);

  const out: PolygonBundle = { ok: false, hasKey: true, rateLimited: false, unauthorized: false };
  let anyOk = false;

  const get = (i: number): FetchResult<any> | null =>
    calls[i].status === "fulfilled" ? (calls[i] as PromiseFulfilledResult<FetchResult<any>>).value : null;

  for (const c of calls) {
    if (c.status === "fulfilled") {
      if (c.value.rateLimited) out.rateLimited = true;
      if (c.value.unauthorized) out.unauthorized = true;
      if (c.value.data != null) anyOk = true;
    }
  }

  // 0 ticker
  const tickerR = get(0);
  if (tickerR?.data?.results) out.ticker = tickerR.data.results;

  // 1 snapshot
  const snapR = get(1);
  if (snapR?.data?.ticker) out.snapshot = snapR.data.ticker;

  // 2 aggs
  const aggsR = get(2);
  if (aggsR?.data?.results && Array.isArray(aggsR.data.results)) {
    out.aggs = aggsR.data.results.map((b: any) => ({
      date: new Date(b.t).toISOString().slice(0, 10),
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
    }));
  }

  // 3 sma50, 4 sma200
  const sma50R = get(3);
  if (sma50R?.data?.results?.values?.[0]?.value != null) {
    out.sma50 = Number(sma50R.data.results.values[0].value);
  }
  const sma200R = get(4);
  if (sma200R?.data?.results?.values?.[0]?.value != null) {
    out.sma200 = Number(sma200R.data.results.values[0].value);
  }

  // 5 rsi
  const rsiR = get(5);
  if (rsiR?.data?.results?.values?.[0]?.value != null) {
    out.rsi14 = Number(rsiR.data.results.values[0].value);
  }

  // 6 macd
  const macdR = get(6);
  const macdV = macdR?.data?.results?.values?.[0];
  if (macdV?.value != null) {
    out.macd = {
      value: Number(macdV.value),
      signal: Number(macdV.signal ?? 0),
      histogram: Number(macdV.histogram ?? (macdV.value - (macdV.signal ?? 0))),
    };
  }

  // 7 financials annual, 8 quarterly
  const finAR = get(7);
  if (finAR?.data?.results) out.financials = finAR.data.results;
  const finQR = get(8);
  if (finQR?.data?.results) out.financialsQuarterly = finQR.data.results;

  // 9 news
  const newsR = get(9);
  if (newsR?.data?.results) out.news = newsR.data.results;

  // 10 dividends
  const divR = get(10);
  if (divR?.data?.results) out.dividends = divR.data.results;

  // 11 trades
  const trR = get(11);
  if (trR?.data?.results?.[0]) out.trades = trR.data.results[0];

  // 12 SPY aggs (used for beta)
  const spyR = get(12);
  if (spyR?.data?.results && Array.isArray(spyR.data.results)) {
    out.spyAggs = spyR.data.results.map((b: any) => ({
      date: new Date(b.t).toISOString().slice(0, 10),
      close: b.c,
    }));
  }

  out.ok = anyOk;
  return out;
}

// ─── Helper extractors ────────────────────────────────────────────────────
// Polygon financials are nested under
//   results[i].financials.{income_statement,balance_sheet,cash_flow_statement}.{field}.value
// Each value is a {value, unit, label} object. This pulls the numeric value.
export const polyFinValue = (statement: any, field: string): number | null => {
  const v = statement?.[field]?.value;
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

// Compute YoY revenue growth from quarterly Polygon financials (q0 vs q4).
export const polyYoYGrowth = (
  quarterly: any[] | undefined,
  field: "revenues" | "net_income_loss" | "basic_earnings_per_share",
): number | null => {
  if (!quarterly || quarterly.length < 5) return null;
  const r0 = polyFinValue(quarterly[0]?.financials?.income_statement, field);
  const r4 = polyFinValue(quarterly[4]?.financials?.income_statement, field);
  if (r0 == null || r4 == null || r4 === 0) return null;
  return (r0 - r4) / Math.abs(r4);
};

// Compute beta using daily returns vs SPY. Both arrays must be same length.
export const polyBeta = (
  stockAggs: { date: string; close: number }[] | undefined,
  spyAggs: { date: string; close: number }[] | undefined,
): number | null => {
  if (!stockAggs?.length || !spyAggs?.length) return null;
  // Align by date
  const spyMap = new Map(spyAggs.map((a) => [a.date, a.close]));
  const stockReturns: number[] = [];
  const spyReturns: number[] = [];
  for (let i = 1; i < stockAggs.length; i++) {
    const sp = spyMap.get(stockAggs[i].date);
    const spPrev = spyMap.get(stockAggs[i - 1].date);
    if (sp == null || spPrev == null || spPrev === 0) continue;
    const stPrev = stockAggs[i - 1].close;
    if (!stPrev) continue;
    stockReturns.push((stockAggs[i].close - stPrev) / stPrev);
    spyReturns.push((sp - spPrev) / spPrev);
  }
  if (stockReturns.length < 30) return null;
  const meanS = stockReturns.reduce((a, b) => a + b, 0) / stockReturns.length;
  const meanM = spyReturns.reduce((a, b) => a + b, 0) / spyReturns.length;
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < stockReturns.length; i++) {
    cov += (stockReturns[i] - meanS) * (spyReturns[i] - meanM);
    varM += (spyReturns[i] - meanM) ** 2;
  }
  if (varM === 0) return null;
  return +(cov / varM).toFixed(3);
};

// Sentiment score 1..5 (Strong Buy..Strong Sell) from Polygon news insights.
export const polyNewsConsensus = (
  news: any[] | undefined,
  ticker: string,
): { score: number | null; label: string | null; total: number } => {
  if (!news?.length) return { score: null, label: null, total: 0 };
  let pos = 0, neg = 0, neu = 0;
  for (const item of news) {
    const insights = item?.insights || [];
    for (const ins of insights) {
      if ((ins?.ticker || "").toUpperCase() !== ticker.toUpperCase()) continue;
      const s = String(ins?.sentiment || "").toLowerCase();
      if (s === "positive") pos++;
      else if (s === "negative") neg++;
      else if (s === "neutral") neu++;
    }
  }
  const total = pos + neg + neu;
  if (total === 0) return { score: null, label: null, total: 0 };
  // Map: positive→1.5, neutral→3, negative→4.5  → 1..5 scale
  const score = (pos * 1.5 + neu * 3 + neg * 4.5) / total;
  const label =
    score <= 1.8 ? "Strong Buy" :
    score <= 2.5 ? "Buy" :
    score <= 3.5 ? "Hold" :
    score <= 4.2 ? "Sell" : "Strong Sell";
  return { score, label, total };
};
