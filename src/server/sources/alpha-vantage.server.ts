// Alpha Vantage source client. Free tier: 25 req/day, 5/min.
// We fan out a small number of high-value calls in parallel; AV will rate-limit
// us to ~5/min so we keep this list short.

const AV = "https://www.alphavantage.co/query";

export type AVBundle = {
  ok: boolean;
  hasKey: boolean;
  rateLimited: boolean;
  overview?: any;
  rsi?: any;
  macd?: any;
  bbands?: any;
  earnings?: any;
};

async function getJson(url: string): Promise<{ data: any | null; rateLimited: boolean }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "StockAnalysisDashboard/1.0" },
    });
    if (!res.ok) return { data: null, rateLimited: res.status === 429 };
    const text = await res.text();
    if (!text) return { data: null, rateLimited: false };
    const json = JSON.parse(text);
    if (json?.Note || json?.Information) {
      const msg = String(json.Note || json.Information).toLowerCase();
      const limited = msg.includes("rate limit") || msg.includes("api key") || msg.includes("requests per");
      return { data: null, rateLimited: limited };
    }
    if (json?.["Error Message"]) return { data: null, rateLimited: false };
    return { data: json, rateLimited: false };
  } catch {
    return { data: null, rateLimited: false };
  }
}

export async function fetchAVBundle(ticker: string, apiKey: string): Promise<AVBundle> {
  if (!apiKey) return { ok: false, hasKey: false, rateLimited: false };
  const k = encodeURIComponent(apiKey);
  const t = encodeURIComponent(ticker);
  const urls = {
    overview: `${AV}?function=OVERVIEW&symbol=${t}&apikey=${k}`,
    rsi: `${AV}?function=RSI&symbol=${t}&interval=daily&time_period=14&series_type=close&apikey=${k}`,
    macd: `${AV}?function=MACD&symbol=${t}&interval=daily&series_type=close&apikey=${k}`,
    bbands: `${AV}?function=BBANDS&symbol=${t}&interval=daily&time_period=20&series_type=close&apikey=${k}`,
    earnings: `${AV}?function=EARNINGS&symbol=${t}&apikey=${k}`,
  };
  const keys = Object.keys(urls) as (keyof typeof urls)[];
  const results = await Promise.allSettled(keys.map((k) => getJson(urls[k])));
  const out: AVBundle = { ok: false, hasKey: true, rateLimited: false };
  let anyOk = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value.rateLimited) out.rateLimited = true;
      if (r.value.data) {
        out[keys[i]] = r.value.data;
        anyOk = true;
      }
    }
  });
  out.ok = anyOk;
  return out;
}

// Convenience extractors. AV returns numeric strings — coerce safely.
export const avNum = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") {
    if (v === "None" || v === "-" || v === "" || v === "0" || v === "0.0") return null;
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  return null;
};

// Pull most-recent value from AV technical indicator response.
export const avLatestTechnical = (resp: any, key: string): number | null => {
  const ta = resp?.["Technical Analysis: " + key.toUpperCase()];
  if (!ta) return null;
  const dates = Object.keys(ta).sort().reverse();
  const latest = ta[dates[0]];
  if (!latest) return null;
  // Find a numeric field (RSI, MACD, MACD_Signal, Real Upper Band, etc.)
  return latest;
};
