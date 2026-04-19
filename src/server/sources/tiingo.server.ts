// Tiingo source client. Server-side only.
// Provides: ratios/margins (statements), daily fundamentals (P/E, P/B, EV),
// news with NLP tags, and EOD prices as a chart fallback.
//
// Free tier: 500 req/day, 50 req/hour. Defensive: any 4xx/5xx is logged and
// returned as "unavailable" so the waterfall falls back to Polygon/SEC.

const TIINGO = "https://api.tiingo.com";

export type TiingoBundle = {
  ok: boolean;
  hasKey: boolean;
  rateLimited: boolean;
  unauthorized: boolean;
  // Latest daily fundamentals row (peRatio, pbRatio, marketCap, etc.)
  daily?: any;
  // Statements: array of period objects with overview + statementData
  statements?: any[];
  // News with sentiment/topic tags
  news?: any[];
  // EOD daily prices (last year)
  eod?: { date: string; open: number; high: number; low: number; close: number; volume: number; adjClose: number }[];
};

type FetchResult<T> = {
  data: T | null;
  status: number;
  rateLimited: boolean;
  unauthorized: boolean;
};

async function tgFetch<T = any>(path: string, token: string, query: Record<string, string> = {}): Promise<FetchResult<T>> {
  const params = new URLSearchParams({ ...query, token });
  const url = `${TIINGO}${path}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "StockAnalysisDashboard/1.0" },
    });
    if (res.status === 429) {
      console.log(`[Tiingo] ${path} → 429 rate-limited`);
      return { data: null, status: 429, rateLimited: true, unauthorized: false };
    }
    if (res.status === 401 || res.status === 403) {
      console.log(`[Tiingo] ${path} → ${res.status} not authorized`);
      return { data: null, status: res.status, rateLimited: false, unauthorized: true };
    }
    if (res.status === 404) {
      // Tiingo returns 404 when fundamentals aren't available for the ticker
      return { data: null, status: 404, rateLimited: false, unauthorized: false };
    }
    if (!res.ok) {
      console.log(`[Tiingo] ${path} → ${res.status}`);
      return { data: null, status: res.status, rateLimited: false, unauthorized: false };
    }
    const text = await res.text();
    if (!text) return { data: null, status: res.status, rateLimited: false, unauthorized: false };
    const json = JSON.parse(text);
    if (json?.detail && typeof json.detail === "string" && /not.*permission|upgrade|subscription/i.test(json.detail)) {
      return { data: null, status: 200, rateLimited: false, unauthorized: true };
    }
    return { data: json as T, status: 200, rateLimited: false, unauthorized: false };
  } catch (e: any) {
    console.log(`[Tiingo] ${path} threw: ${e?.message}`);
    return { data: null, status: 0, rateLimited: false, unauthorized: false };
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function fetchTiingoBundle(ticker: string): Promise<TiingoBundle> {
  const token = (process.env.TIINGO_API_KEY || "").trim();
  if (!token) {
    return { ok: false, hasKey: false, rateLimited: false, unauthorized: false };
  }
  const t = encodeURIComponent(ticker.toLowerCase());

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const calls = await Promise.allSettled([
    // Tiingo paid-only fundamentals — usually 401/403 on free tier; that's OK.
    tgFetch(`/tiingo/fundamentals/${t}/daily`, token),
    tgFetch(`/tiingo/fundamentals/${t}/statements`, token),
    // News (free tier supports a limited number of tickers)
    tgFetch(`/tiingo/news`, token, { tickers: ticker, limit: "10" }),
    // EOD prices (free tier supports this for most US tickers)
    tgFetch(`/tiingo/daily/${t}/prices`, token, { startDate: ymd(oneYearAgo) }),
  ]);

  const out: TiingoBundle = { ok: false, hasKey: true, rateLimited: false, unauthorized: false };
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

  // Daily fundamentals — array; latest first
  const dailyR = get(0);
  if (Array.isArray(dailyR?.data) && dailyR.data.length) {
    out.daily = dailyR.data[dailyR.data.length - 1];
  }

  // Statements — array of period objects; keep last 4
  const stmtR = get(1);
  if (Array.isArray(stmtR?.data) && stmtR.data.length) {
    out.statements = stmtR.data.slice(0, 4);
  }

  // News
  const newsR = get(2);
  if (Array.isArray(newsR?.data)) out.news = newsR.data;

  // EOD prices
  const eodR = get(3);
  if (Array.isArray(eodR?.data) && eodR.data.length) {
    out.eod = eodR.data
      .filter((d: any) => d?.date)
      .map((d: any) => ({
        date: String(d.date).slice(0, 10),
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
        volume: Number(d.volume),
        adjClose: Number(d.adjClose ?? d.close),
      }));
  }

  out.ok = anyOk;
  return out;
}

// ─── Helper extractors ────────────────────────────────────────────────────
// Tiingo daily fundamentals row contains pre-computed ratios.
export const tgDaily = (bundle: TiingoBundle | null, key: string): number | null => {
  const v = bundle?.daily?.[key];
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) && n !== 0 ? n : null;
};

// Tiingo statements: each period has an `overview` block with margins/ratios.
// We extract from the most recent period.
export const tgOverview = (bundle: TiingoBundle | null, key: string): number | null => {
  const stmt = bundle?.statements?.[0];
  const v = stmt?.overview?.[key];
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

// Earnings beat rate from statements — count quarters where actual EPS > est.
export const tgBeatRate = (bundle: TiingoBundle | null): { beats: number; total: number } | null => {
  const stmts = bundle?.statements;
  if (!stmts?.length) return null;
  let beats = 0, total = 0;
  for (const s of stmts) {
    const actual = Number(s?.statementData?.incomeStatement?.find?.((r: any) => r.dataCode === "epsBasic")?.value);
    const est = Number(s?.statementData?.estimates?.eps);
    if (isFinite(actual) && isFinite(est)) {
      total++;
      if (actual > est) beats++;
    }
  }
  return total > 0 ? { beats, total } : null;
};
