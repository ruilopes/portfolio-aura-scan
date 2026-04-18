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
  filings: { form: string; filingDate: string; reportDate: string | null; accession: string; primaryDoc: string }[];
};

export type FilingTimeliness = {
  status: "ok" | "late" | "missing";
  label: string;
  detail: string;
};

// Inspect the submissions feed and judge if the company is current on its
// mandatory periodic reports (10-K annual, 10-Q quarterly).
// Deadlines (large/accelerated filers): 10-K = 90 days after period end,
// 10-Q = 45 days after period end. We use the looser end of the SEC ranges
// so we don't false-flag smaller filers.
export function checkFilingTimeliness(submissions: SECSubmissions | null): FilingTimeliness {
  if (!submissions || !submissions.filings?.length) {
    return { status: "ok", label: "Filing status unknown", detail: "No SEC submission data available." };
  }
  const today = new Date();
  const dayMs = 86400 * 1000;

  const tenK = submissions.filings.find((f) => f.form === "10-K");
  const tenQ = submissions.filings.find((f) => f.form === "10-Q");

  const lateBy = (filingDate: string, reportDate: string | null, deadlineDays: number): number | null => {
    if (!reportDate) return null;
    const period = new Date(reportDate);
    const filed = new Date(filingDate);
    if (isNaN(period.getTime()) || isNaN(filed.getTime())) return null;
    const due = new Date(period.getTime() + deadlineDays * dayMs);
    return Math.round((filed.getTime() - due.getTime()) / dayMs);
  };

  // MISSING: most recent 10-K's reporting period is older than ~15 months
  // (annual cycle ~12 months + 90-day deadline + 90-day grace).
  if (tenK?.reportDate) {
    const ageDays = (today.getTime() - new Date(tenK.reportDate).getTime()) / dayMs;
    if (ageDays > 460) {
      return {
        status: "missing",
        label: "Missing filing",
        detail: `10-K for fiscal year ending ${tenK.reportDate} has not been followed by a more recent annual report.`,
      };
    }
  }
  // MISSING: most recent 10-Q period older than ~6 months (quarterly cycle
  // 3 months + 45-day deadline + grace).
  if (tenQ?.reportDate) {
    const ageDays = (today.getTime() - new Date(tenQ.reportDate).getTime()) / dayMs;
    if (ageDays > 180) {
      return {
        status: "missing",
        label: "Missing filing",
        detail: `10-Q for quarter ending ${tenQ.reportDate} has not been followed by a more recent quarterly report.`,
      };
    }
  }

  // LATE: filed after the deadline.
  if (tenK) {
    const late = lateBy(tenK.filingDate, tenK.reportDate, 90);
    if (late != null && late > 0) {
      return {
        status: "late",
        label: "Late filing detected",
        detail: `10-K for FY ending ${tenK.reportDate} filed ${late} day${late === 1 ? "" : "s"} late.`,
      };
    }
  }
  if (tenQ) {
    const late = lateBy(tenQ.filingDate, tenQ.reportDate, 45);
    if (late != null && late > 0) {
      return {
        status: "late",
        label: "Late filing detected",
        detail: `10-Q for quarter ending ${tenQ.reportDate} filed ${late} day${late === 1 ? "" : "s"} late.`,
      };
    }
  }

  return {
    status: "ok",
    label: "SEC filings up to date",
    detail: "10-K and 10-Q filed on time.",
  };
}

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
            reportDate: r.reportDate?.[i] || null,
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
      filings,
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
