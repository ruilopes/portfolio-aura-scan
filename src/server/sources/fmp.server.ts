// Financial Modeling Prep source client. Free tier: 250 req/day, 5/min.
// Skips silently when no key is provided.

const FMP = "https://financialmodelingprep.com/api/v3";

export type FMPBundle = {
  ok: boolean;
  hasKey: boolean;
  rateLimited: boolean;
  profile?: any;
  ratiosTtm?: any;
  income?: any[];
  balance?: any[];
  cashflow?: any[];
  earningsSurprises?: any[];
  analystEstimates?: any[];
  analystRecs?: any[];
  priceTargets?: any[];
  institutionalHolders?: any[];
  insiderTrading?: any[];
  news?: any[];
};

async function getJson<T>(url: string): Promise<{ data: T | null; rateLimited: boolean }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "StockAnalysisDashboard/1.0" },
    });
    if (res.status === 429) return { data: null, rateLimited: true };
    if (!res.ok) return { data: null, rateLimited: false };
    const text = await res.text();
    if (!text) return { data: null, rateLimited: false };
    const json = JSON.parse(text) as any;
    // FMP returns { "Error Message": "..." } when the key is invalid or quota
    // exhausted, but with HTTP 200.
    if (json && typeof json === "object" && "Error Message" in json) {
      const msg = String(json["Error Message"]).toLowerCase();
      const limited = msg.includes("limit") || msg.includes("quota");
      return { data: null, rateLimited: limited };
    }
    return { data: json as T, rateLimited: false };
  } catch {
    return { data: null, rateLimited: false };
  }
}

export async function fetchFMPBundle(
  ticker: string,
  apiKey: string,
): Promise<FMPBundle> {
  if (!apiKey) {
    return { ok: false, hasKey: false, rateLimited: false };
  }
  const k = encodeURIComponent(apiKey);
  const t = encodeURIComponent(ticker);
  const urls = {
    profile: `${FMP}/profile/${t}?apikey=${k}`,
    ratiosTtm: `${FMP}/ratios-ttm/${t}?apikey=${k}`,
    income: `${FMP}/income-statement/${t}?limit=5&apikey=${k}`,
    balance: `${FMP}/balance-sheet-statement/${t}?limit=4&apikey=${k}`,
    cashflow: `${FMP}/cash-flow-statement/${t}?limit=4&apikey=${k}`,
    earningsSurprises: `${FMP}/earnings-surprises/${t}?apikey=${k}`,
    analystEstimates: `${FMP}/analyst-estimates/${t}?limit=2&apikey=${k}`,
    analystRecs: `${FMP}/analyst-stock-recommendations/${t}?limit=10&apikey=${k}`,
    priceTargets: `${FMP}/price-target/${t}?limit=10&apikey=${k}`,
    institutionalHolders: `${FMP}/institutional-holder/${t}?apikey=${k}`,
    insiderTrading: `${FMP}/insider-trading?symbol=${t}&limit=10&apikey=${k}`,
    news: `${FMP}/stock-news?tickers=${t}&limit=5&apikey=${k}`,
  };
  const keys = Object.keys(urls) as (keyof typeof urls)[];
  const results = await Promise.allSettled(keys.map((k) => getJson<any>(urls[k])));
  const out: FMPBundle = { ok: false, hasKey: true, rateLimited: false };
  let anyOk = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value.rateLimited) out.rateLimited = true;
      if (r.value.data != null) {
        // First entry of array endpoints is the latest period
        const k = keys[i];
        if (k === "profile" || k === "ratiosTtm") {
          out[k] = Array.isArray(r.value.data) ? r.value.data[0] : r.value.data;
        } else {
          out[k] = Array.isArray(r.value.data) ? r.value.data : [];
        }
        anyOk = true;
      }
    }
  });
  out.ok = anyOk;
  return out;
}
