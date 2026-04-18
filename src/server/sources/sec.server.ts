// SEC EDGAR source client (no key required, US gov).
// SEC requires a descriptive User-Agent.

const SEC = "https://data.sec.gov";
const SEC_FILES = "https://www.sec.gov/files";

const SEC_HEADERS = {
  "User-Agent": "StockAnalysisDashboard research@example.com",
  Accept: "application/json",
};

export type SECBundle = {
  ok: boolean;
  cik: string | null;
  submissions: SECSubmissions | null;
  facts: SECFacts | null;
};

export type SECSubmissions = {
  name: string | null;
  sic: string | null;
  sicDescription: string | null;
  stateOfIncorporation: string | null;
  fiscalYearEnd: string | null;
  filings: { form: string; filingDate: string; accession: string; primaryDoc: string }[];
};

export type SECFacts = {
  revenues: number | null;
  netIncome: number | null;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  eps: number | null;
  sharesOutstanding: number | null;
  longTermDebt: number | null;
  operatingIncome: number | null;
  grossProfit: number | null;
  rdExpense: number | null;
  // 4 most recent annual revenue values for growth calcs (newest first).
  revenueHistory: { fy: number; val: number }[];
};

let cikCache: Map<string, string> | null = null;
let cikCacheAt = 0;
const CIK_TTL = 24 * 3600 * 1000;

export async function tickerToCIK(ticker: string): Promise<string | null> {
  const now = Date.now();
  if (!cikCache || now - cikCacheAt > CIK_TTL) {
    try {
      const res = await fetch(`${SEC_FILES}/company_tickers.json`, { headers: SEC_HEADERS });
      if (!res.ok) return null;
      const data: any = await res.json();
      const map = new Map<string, string>();
      for (const k of Object.keys(data)) {
        const row = data[k];
        if (row?.ticker && row?.cik_str != null) {
          map.set(String(row.ticker).toUpperCase(), String(row.cik_str).padStart(10, "0"));
        }
      }
      cikCache = map;
      cikCacheAt = now;
    } catch {
      return null;
    }
  }
  return cikCache.get(ticker.toUpperCase()) || null;
}

async function fetchSubmissions(cik: string): Promise<SECSubmissions | null> {
  try {
    const res = await fetch(`${SEC}/submissions/CIK${cik}.json`, { headers: SEC_HEADERS });
    if (!res.ok) return null;
    const data: any = await res.json();
    const r = data.filings?.recent;
    const filings: SECSubmissions["filings"] = [];
    if (r?.form) {
      for (let i = 0; i < r.form.length && filings.length < 10; i++) {
        if (["10-K", "10-Q", "8-K"].includes(r.form[i])) {
          filings.push({
            form: r.form[i],
            filingDate: r.filingDate[i],
            accession: r.accessionNumber[i],
            primaryDoc: r.primaryDocument[i],
          });
        }
      }
    }
    return {
      name: data.name || null,
      sic: data.sic || null,
      sicDescription: data.sicDescription || null,
      stateOfIncorporation: data.stateOfIncorporation || null,
      fiscalYearEnd: data.fiscalYearEnd || null,
      filings: filings.slice(0, 5),
    };
  } catch {
    return null;
  }
}

// Pull all annual values for a us-gaap concept from XBRL company facts.
function annualSeries(gaap: any, concept: string): { fy: number; val: number }[] {
  const c = gaap[concept];
  if (!c?.units?.USD) return [];
  const annual = c.units.USD
    .filter((x: any) => x.form === "10-K" && x.fp === "FY" && typeof x.val === "number")
    .map((x: any) => ({ fy: x.fy as number, val: x.val as number, end: x.end as string }));
  // Newest first; dedupe by fy keeping the most recent end-date per FY.
  const byFy = new Map<number, { fy: number; val: number; end: string }>();
  annual.sort((a: any, b: any) => (a.end || "").localeCompare(b.end || ""));
  for (const x of annual) byFy.set(x.fy, x);
  return Array.from(byFy.values())
    .sort((a, b) => b.fy - a.fy)
    .map(({ fy, val }) => ({ fy, val }));
}

function latestAnnual(gaap: any, concept: string): number | null {
  const s = annualSeries(gaap, concept);
  return s[0]?.val ?? null;
}

async function fetchFacts(cik: string): Promise<SECFacts | null> {
  try {
    const res = await fetch(`${SEC}/api/xbrl/companyfacts/CIK${cik}.json`, { headers: SEC_HEADERS });
    if (!res.ok) return null;
    const data: any = await res.json();
    const gaap = data?.facts?.["us-gaap"];
    if (!gaap) return null;
    const revenueHistory =
      annualSeries(gaap, "Revenues").length > 0
        ? annualSeries(gaap, "Revenues")
        : annualSeries(gaap, "RevenueFromContractWithCustomerExcludingAssessedTax");
    return {
      revenues:
        latestAnnual(gaap, "Revenues") ??
        latestAnnual(gaap, "RevenueFromContractWithCustomerExcludingAssessedTax"),
      netIncome: latestAnnual(gaap, "NetIncomeLoss"),
      assets: latestAnnual(gaap, "Assets"),
      liabilities: latestAnnual(gaap, "Liabilities"),
      equity: latestAnnual(gaap, "StockholdersEquity"),
      eps: latestAnnual(gaap, "EarningsPerShareBasic"),
      sharesOutstanding: latestAnnual(gaap, "CommonStockSharesOutstanding"),
      longTermDebt: latestAnnual(gaap, "LongTermDebt"),
      operatingIncome: latestAnnual(gaap, "OperatingIncomeLoss"),
      grossProfit: latestAnnual(gaap, "GrossProfit"),
      rdExpense: latestAnnual(gaap, "ResearchAndDevelopmentExpense"),
      revenueHistory: revenueHistory.slice(0, 4),
    };
  } catch {
    return null;
  }
}

export async function fetchSECBundle(ticker: string): Promise<SECBundle> {
  const cik = await tickerToCIK(ticker);
  if (!cik) return { ok: false, cik: null, submissions: null, facts: null };
  const [submissions, facts] = await Promise.all([fetchSubmissions(cik), fetchFacts(cik)]);
  return { ok: !!(submissions || facts), cik, submissions, facts };
}
