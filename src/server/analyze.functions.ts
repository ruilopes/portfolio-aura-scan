import { createServerFn } from "@tanstack/react-start";

const YAHOO = "https://query1.finance.yahoo.com";
const SEC = "https://data.sec.gov";
const SEC_FILES = "https://www.sec.gov/files";
const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary";

// Yahoo / SEC require a non-default User-Agent. SEC requires it explicitly.
const UA = {
  "User-Agent": "StockAnalysisDashboard/1.0 (research@example.com)",
  Accept: "application/json, text/plain, */*",
};

async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const r = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers || {}) } });
    const status = r.status;
    if (!r.ok) return { ok: false, status, data: null };
    const text = await r.text();
    if (!text) return { ok: true, status, data: null };
    try {
      return { ok: true, status, data: JSON.parse(text) };
    } catch {
      return { ok: true, status, data: text };
    }
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// ─────────────────────────────────────────────────────────────────
// Yahoo quoteSummary — call modules in small batches (Yahoo limits)
// ─────────────────────────────────────────────────────────────────
async function yahooSummary(ticker: string, modules: string[]) {
  const url = `${YAHOO}/v10/finance/quoteSummary/${encodeURIComponent(
    ticker,
  )}?modules=${modules.join(",")}&corsDomain=finance.yahoo.com`;
  const res = await safeFetch(url);
  return res.data?.quoteSummary?.result?.[0] || null;
}

// Yahoo wraps numbers in { raw, fmt, longFmt }. Unwrap.
const r = (x: any): number | null => {
  if (x == null) return null;
  if (typeof x === "number") return isFinite(x) ? x : null;
  if (typeof x === "object" && "raw" in x) return typeof x.raw === "number" && isFinite(x.raw) ? x.raw : null;
  return null;
};
const rs = (x: any): string | null => {
  if (x == null) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object" && "fmt" in x) return x.fmt;
  return null;
};

async function fetchYahooChart(symbol: string) {
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=1y`;
  const res = await safeFetch(url);
  const result = res.data?.chart?.result?.[0];
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
    .filter((p) => p.close != null) as {
    date: string;
    close: number;
    high: number;
    low: number;
    volume: number;
  }[];
  return { meta: result.meta || {}, series };
}

// ─────────────────────────────────────────────────────────────────
// Technical calcs (client-side per spec, but we precompute server-side)
// ─────────────────────────────────────────────────────────────────
function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}
function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}
function ema(vals: number[], p: number) {
  const k = 2 / (p + 1);
  let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const out: number[] = [e];
  for (let i = p; i < vals.length; i++) {
    e = vals[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}
function macdCalc(values: number[]) {
  if (values.length < 35) return null;
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  const offset = e12.length - e26.length;
  const macdLine = e26.map((v, i) => e12[i + offset] - v);
  const sig = ema(macdLine, 9);
  const m = macdLine[macdLine.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, hist: m - s };
}
function bollinger(values: number[], period = 20, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period);
  return { mid: mean, upper: mean + mult * sd, lower: mean - mult * sd };
}
function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}
function histVolatility(closes: number[]) {
  const logRets: number[] = [];
  for (let i = Math.max(1, closes.length - 30); i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) logRets.push(Math.log(closes[i] / closes[i - 1]));
  }
  return stddev(logRets) * Math.sqrt(252);
}

// ─────────────────────────────────────────────────────────────────
// Ticker → CIK via SEC's official mapping file (cached structure)
// ─────────────────────────────────────────────────────────────────
let cikCache: Map<string, string> | null = null;
let cikCacheAt = 0;
const CIK_TTL = 24 * 3600 * 1000;

async function tickerToCIK(ticker: string): Promise<string | null> {
  const now = Date.now();
  if (!cikCache || now - cikCacheAt > CIK_TTL) {
    const res = await safeFetch(`${SEC_FILES}/company_tickers.json`);
    if (!res.ok || !res.data) return null;
    const map = new Map<string, string>();
    for (const k of Object.keys(res.data)) {
      const row = res.data[k];
      if (row?.ticker && row?.cik_str != null) {
        map.set(String(row.ticker).toUpperCase(), String(row.cik_str).padStart(10, "0"));
      }
    }
    cikCache = map;
    cikCacheAt = now;
  }
  return cikCache.get(ticker.toUpperCase()) || null;
}

async function fetchSECSubmissions(cik: string) {
  const res = await safeFetch(`${SEC}/submissions/CIK${cik}.json`);
  if (!res.ok || !res.data) return null;
  const r = res.data.filings?.recent;
  const filings: { form: string; filingDate: string; accession: string; primaryDoc: string }[] = [];
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
    sic: res.data.sic || null,
    sicDescription: res.data.sicDescription || null,
    stateOfIncorporation: res.data.stateOfIncorporation || null,
    fiscalYearEnd: res.data.fiscalYearEnd || null,
    filings: filings.slice(0, 5),
  };
}

async function fetchSECFacts(cik: string) {
  const res = await safeFetch(`${SEC}/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!res.ok || !res.data?.facts?.["us-gaap"]) return null;
  const gaap = res.data.facts["us-gaap"];
  // Extract the most recent annual (FY) value for a concept
  const latestAnnual = (concept: string): number | null => {
    const c = gaap[concept];
    if (!c?.units?.USD) return null;
    const annual = c.units.USD.filter((x: any) => x.form === "10-K" && x.fp === "FY");
    annual.sort((a: any, b: any) => (b.end || "").localeCompare(a.end || ""));
    return annual[0]?.val ?? null;
  };
  return {
    revenues: latestAnnual("Revenues") ?? latestAnnual("RevenueFromContractWithCustomerExcludingAssessedTax"),
    netIncome: latestAnnual("NetIncomeLoss"),
    assets: latestAnnual("Assets"),
    liabilities: latestAnnual("Liabilities"),
    equity: latestAnnual("StockholdersEquity"),
  };
}

// ─────────────────────────────────────────────────────────────────
// FRED CSV — keyless
// ─────────────────────────────────────────────────────────────────
async function fetchFredCsv(seriesId: string): Promise<number | null> {
  const res = await safeFetch(`${FRED_CSV}?id=${seriesId}`);
  if (!res.ok || typeof res.data !== "string") return null;
  const lines = res.data.trim().split("\n");
  // Walk from end finding last non-"." numeric
  for (let i = lines.length - 1; i > 0; i--) {
    const cols = lines[i].split(",");
    const v = cols[1]?.trim();
    if (v && v !== "." && !isNaN(parseFloat(v))) return parseFloat(v);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Wikipedia summary fallback
// ─────────────────────────────────────────────────────────────────
async function fetchWikiSummary(name: string): Promise<string | null> {
  if (!name) return null;
  const res = await safeFetch(`${WIKI}/${encodeURIComponent(name)}`);
  if (!res.ok || !res.data) return null;
  return res.data.extract || null;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const score = (v: number | null, breaks: { lt: number; s: number }[]) => {
  if (v == null || !isFinite(v)) return 5;
  for (const b of breaks) if (v < b.lt) return b.s;
  return breaks[breaks.length - 1].s;
};
const sBand = (v: number | null, low: number, mid: number, high: number) => {
  if (v == null) return 5;
  if (v > high) return 10;
  if (v > mid) return 7;
  if (v > low) return 4;
  return 1;
};

// Cross-validation: compare two values, return confidence label
type Confidence = "high" | "medium" | "low";
function confidenceFor(yahoo: number | null, sec: number | null): Confidence {
  if (yahoo == null && sec == null) return "low";
  if (yahoo == null || sec == null) return "medium";
  if (yahoo === 0 && sec === 0) return "high";
  const denom = Math.max(Math.abs(yahoo), Math.abs(sec));
  if (denom === 0) return "high";
  const diff = Math.abs(yahoo - sec) / denom;
  return diff <= 0.05 ? "high" : "low";
}

// ─────────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────────
export const analyzeStock = createServerFn({ method: "POST" })
  .inputValidator((d: { ticker: string }) => {
    const t = (d?.ticker || "").trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(t)) throw new Error("Invalid ticker");
    return { ticker: t };
  })
  .handler(async ({ data }) => {
    const { ticker } = data;
    const sources = {
      yahoo: false,
      yahooChart: false,
      sec: false,
      secFacts: false,
      fred: false,
      wiki: false,
    };

    // Module batches — Yahoo rejects too many at once
    const batchA = [
      "price",
      "summaryDetail",
      "defaultKeyStatistics",
      "financialData",
      "assetProfile",
    ];
    const batchB = [
      "incomeStatementHistory",
      "balanceSheetHistory",
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

    const [a, b, c, chart, cik] = await Promise.allSettled([
      yahooSummary(ticker, batchA),
      yahooSummary(ticker, batchB),
      yahooSummary(ticker, batchC),
      fetchYahooChart(ticker),
      tickerToCIK(ticker),
    ]);

    const sumA = a.status === "fulfilled" ? a.value : null;
    const sumB = b.status === "fulfilled" ? b.value : null;
    const sumC = c.status === "fulfilled" ? c.value : null;
    const yahooChart = chart.status === "fulfilled" ? chart.value : null;
    const cikValue = cik.status === "fulfilled" ? cik.value : null;

    if (sumA || sumB || sumC) sources.yahoo = true;
    if (yahooChart) sources.yahooChart = true;

    const price = sumA?.price || {};
    const sd = sumA?.summaryDetail || {};
    const ks = sumA?.defaultKeyStatistics || {};
    const fin = sumA?.financialData || {};
    const profile = sumA?.assetProfile || {};
    const incomeHist = sumB?.incomeStatementHistory?.incomeStatementHistory || [];
    const balanceHist = sumB?.balanceSheetHistory?.balanceSheetStatements || [];
    const cashHist = sumB?.cashflowStatementHistory?.cashflowStatements || [];
    const earningsTrend = sumB?.earningsTrend?.trend || [];
    const recTrend = sumC?.recommendationTrend?.trend || [];
    const upgrades = sumC?.upgradeDowngradeHistory?.history || [];
    const instOwn = sumC?.institutionOwnership?.ownershipList || [];
    const insiderHolders = sumC?.insiderHolders?.holders || [];
    const insiderTx = sumC?.insiderTransactions?.transactions || [];
    const calendar = sumC?.calendarEvents || {};
    const esg = sumC?.esgScores || {};
    const secFilingsYahoo = sumC?.secFilings?.filings || [];

    // Parallel: SEC submissions, SEC facts, FRED, Wikipedia
    const wikiName = price?.longName || price?.shortName || ticker;
    const [secSub, secFacts, fedFunds, dgs10, cpi, dxy, vix, wiki] = await Promise.all([
      cikValue ? fetchSECSubmissions(cikValue) : Promise.resolve(null),
      cikValue ? fetchSECFacts(cikValue) : Promise.resolve(null),
      fetchFredCsv("FEDFUNDS"),
      fetchFredCsv("DGS10"),
      fetchFredCsv("CPIAUCSL"),
      fetchFredCsv("DTWEXBGS"),
      fetchFredCsv("VIXCLS"),
      fetchWikiSummary(wikiName),
    ]);

    if (secSub) sources.sec = true;
    if (secFacts) sources.secFacts = true;
    if (fedFunds != null || dgs10 != null || cpi != null) sources.fred = true;
    if (wiki) sources.wiki = true;

    // ─── Company info ───
    const company = {
      name: rs(price?.longName) || rs(price?.shortName) || ticker,
      sector: profile?.sector || null,
      industry: profile?.industry || null,
      country: profile?.country || null,
      exchange: rs(price?.exchangeName) || price?.exchange || null,
      cik: cikValue,
      website: profile?.website || null,
      description:
        profile?.longBusinessSummary ||
        wiki ||
        null,
      sic: secSub?.sic || null,
      sicDescription: secSub?.sicDescription || null,
      stateOfIncorporation: secSub?.stateOfIncorporation || null,
      fiscalYearEnd: secSub?.fiscalYearEnd || null,
      employees: r(profile?.fullTimeEmployees),
    };

    // ─── Price + chart ───
    const series = yahooChart?.series || [];
    const closes = series.map((p) => p.close);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    // Show last 6 months in chart
    const sixMo = Math.max(0, closes.length - 126);
    const priceChart = series.slice(sixMo).map((p, i) => ({
      date: p.date,
      close: p.close,
      sma50: sma50[sixMo + i],
      sma200: sma200[sixMo + i],
    }));

    const currentPrice = r(price?.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
    const high52 = r(sd?.fiftyTwoWeekHigh) ?? (closes.length ? Math.max(...closes) : null);
    const low52 = r(sd?.fiftyTwoWeekLow) ?? (closes.length ? Math.min(...closes) : null);
    const dayHigh = r(sd?.regularMarketDayHigh) ?? r(price?.regularMarketDayHigh);
    const dayLow = r(sd?.regularMarketDayLow) ?? r(price?.regularMarketDayLow);
    const volume = r(sd?.regularMarketVolume) ?? r(price?.regularMarketVolume);
    const avgVol = r(sd?.averageVolume);
    const avgVol10 = r(sd?.averageVolume10days);
    const fiftyDayAvg = r(sd?.fiftyDayAverage);
    const twoHundredDayAvg = r(sd?.twoHundredDayAverage);
    const changePct = r(price?.regularMarketChangePercent);
    const change = r(price?.regularMarketChange);

    // Technicals
    const rsiVal = rsi(closes, 14);
    const macdVal = macdCalc(closes);
    const bb = bollinger(closes, 20, 2);
    const histVol = histVolatility(closes);
    const sma50Last = sma50[sma50.length - 1];
    const sma200Last = sma200[sma200.length - 1];
    const priceVs50 = sma50Last && currentPrice ? (currentPrice - sma50Last) / sma50Last : null;
    const priceVs200 = sma200Last && currentPrice ? (currentPrice - sma200Last) / sma200Last : null;
    const pos52w = currentPrice && high52 && low52 ? (currentPrice - low52) / (high52 - low52) : null;

    // ─── Valuation ───
    const marketCap = r(sd?.marketCap) ?? r(price?.marketCap);
    const trailingPE = r(sd?.trailingPE) ?? r(ks?.trailingPE);
    const forwardPE = r(sd?.forwardPE) ?? r(ks?.forwardPE);
    const priceToBook = r(ks?.priceToBook);
    const ps = r(sd?.priceToSalesTrailing12Months);
    const evEbitda = r(ks?.enterpriseToEbitda);
    const peg = r(ks?.pegRatio);
    const enterpriseValue = r(ks?.enterpriseValue);

    // ─── Quality ───
    const grossMargins = r(fin?.grossMargins);
    const opMargin = r(fin?.operatingMargins);
    const profitMargins = r(fin?.profitMargins);
    const roe = r(fin?.returnOnEquity);
    const roa = r(fin?.returnOnAssets);
    const de = r(fin?.debtToEquity);
    const currentRatio = r(fin?.currentRatio);
    const quickRatio = r(fin?.quickRatio);
    const freeCashflow = r(fin?.freeCashflow);
    const totalCash = r(fin?.totalCash);
    const totalDebt = r(fin?.totalDebt);
    const revenuePerShare = r(fin?.revenuePerShare);
    const eps = r(ks?.trailingEps);
    const fcfYield = freeCashflow && marketCap ? freeCashflow / marketCap : null;

    // Normalise debt/equity (Yahoo returns it as a percentage e.g. 195 = 1.95)
    const deNorm = de != null && de > 5 ? de / 100 : de;

    // ─── Growth ───
    const revenueGrowth = r(fin?.revenueGrowth);
    const earningsGrowth = r(fin?.earningsGrowth);
    const earningsQGrowth = r(ks?.earningsQuarterlyGrowth);
    const revenueQGrowth = r(sd?.revenueQuarterlyGrowth);

    // YoY from quarterly statements (4 latest)
    let manualRevYoY: number | null = null;
    if (incomeHist.length >= 4) {
      const recent = r(incomeHist[0]?.totalRevenue);
      const yearAgo = r(incomeHist[3]?.totalRevenue);
      if (recent && yearAgo && yearAgo > 0) manualRevYoY = (recent - yearAgo) / yearAgo;
    }

    // ─── Sentiment ───
    const lastRec = recTrend[0] || {};
    const buy = (lastRec.buy ?? 0) + (lastRec.strongBuy ?? 0);
    const hold = lastRec.hold ?? 0;
    const sell = (lastRec.sell ?? 0) + (lastRec.strongSell ?? 0);
    const totalAnalysts = buy + hold + sell;
    const consensusScore =
      totalAnalysts > 0
        ? ((lastRec.strongBuy ?? 0) * 1 +
            (lastRec.buy ?? 0) * 2 +
            (lastRec.hold ?? 0) * 3 +
            (lastRec.sell ?? 0) * 4 +
            (lastRec.strongSell ?? 0) * 5) /
          totalAnalysts
        : null;
    const consensusLabel =
      consensusScore == null
        ? null
        : consensusScore <= 1.5
        ? "Strong Buy"
        : consensusScore <= 2.5
        ? "Buy"
        : consensusScore <= 3.5
        ? "Hold"
        : consensusScore <= 4.5
        ? "Sell"
        : "Strong Sell";
    const targetPrice = r(fin?.targetMeanPrice);
    const upside = targetPrice && currentPrice ? (targetPrice - currentPrice) / currentPrice : null;

    const recentUpgrades = upgrades.slice(0, 10).map((u: any) => ({
      date: u.epochGradeDate ? new Date(u.epochGradeDate * 1000).toISOString().slice(0, 10) : null,
      firm: u.firm || null,
      action: u.action || null,
      toGrade: u.toGrade || null,
      fromGrade: u.fromGrade || null,
    }));

    const topHolders = instOwn.slice(0, 5).map((h: any) => ({
      organization: h.organization || null,
      pctHeld: r(h.pctHeld),
      reportDate: h.reportDate?.fmt || null,
      value: r(h.value),
    }));

    const heldPctInst = r(ks?.heldPercentInstitutions);
    const heldPctInsiders = r(ks?.heldPercentInsiders);

    const recentInsiderTx = insiderTx.slice(0, 5).map((t: any) => ({
      filerName: t.filerName || null,
      filerRelation: t.filerRelation || null,
      transactionText: t.transactionText || null,
      shares: r(t.shares),
      value: r(t.value),
      startDate: t.startDate?.fmt || null,
    }));

    // ─── Risk extras ───
    const beta = r(sd?.beta) ?? r(ks?.beta);
    const shortRatio = r(ks?.shortRatio) ?? r(sd?.shortRatio);
    const shortPct = r(ks?.shortPercentOfFloat);

    // ─── ESG ───
    const esgData = {
      total: r(esg?.totalEsg),
      env: r(esg?.environmentScore),
      social: r(esg?.socialScore),
      gov: r(esg?.governanceScore),
      perf: esg?.esgPerformance || null,
      controversy: r(esg?.highestControversy),
    };

    // ─── Earnings ───
    const nextEarnings = calendar?.earnings?.earningsDate?.[0]?.fmt || null;
    const nextEPSEst = r(calendar?.earnings?.earningsAverage);
    const nextRevEst = r(calendar?.earnings?.revenueAverage);

    // ─── SEC filings: prefer EDGAR official; fall back to Yahoo's secFilings ───
    const filings =
      (secSub?.filings && secSub.filings.length ? secSub.filings : null) ||
      secFilingsYahoo.slice(0, 5).map((f: any) => ({
        form: f.type,
        filingDate: f.date,
        accession: "",
        primaryDoc: "",
        url: f.edgarUrl || null,
      })) ||
      [];

    // ─── Cross-validation (Yahoo vs SEC company facts) ───
    // Yahoo TTM revenue from financialData (may be null) — use latest annual income statement instead
    const yahooAnnualRevenue = r(incomeHist[0]?.totalRevenue);
    const yahooAnnualNetIncome = r(incomeHist[0]?.netIncome);
    const yahooAssets = r(balanceHist[0]?.totalAssets);
    const yahooLiabilities = r(balanceHist[0]?.totalLiab);
    const yahooEquity = r(balanceHist[0]?.totalStockholderEquity);
    const confidence = {
      revenue: confidenceFor(yahooAnnualRevenue, secFacts?.revenues ?? null),
      netIncome: confidenceFor(yahooAnnualNetIncome, secFacts?.netIncome ?? null),
      assets: confidenceFor(yahooAssets, secFacts?.assets ?? null),
      liabilities: confidenceFor(yahooLiabilities, secFacts?.liabilities ?? null),
      equity: confidenceFor(yahooEquity, secFacts?.equity ?? null),
    };
    const crossCheck = {
      revenue: { yahoo: yahooAnnualRevenue, sec: secFacts?.revenues ?? null, confidence: confidence.revenue },
      netIncome: { yahoo: yahooAnnualNetIncome, sec: secFacts?.netIncome ?? null, confidence: confidence.netIncome },
      assets: { yahoo: yahooAssets, sec: secFacts?.assets ?? null, confidence: confidence.assets },
      liabilities: { yahoo: yahooLiabilities, sec: secFacts?.liabilities ?? null, confidence: confidence.liabilities },
      equity: { yahoo: yahooEquity, sec: secFacts?.equity ?? null, confidence: confidence.equity },
    };

    // ─── Card sub-scores ───
    const card1Sub = [
      { k: "P/E TTM", v: trailingPE, s: score(trailingPE, [{ lt: 15, s: 10 }, { lt: 25, s: 7 }, { lt: 35, s: 4 }, { lt: Infinity, s: 1 }]) },
      { k: "Forward P/E", v: forwardPE, s: score(forwardPE, [{ lt: 12, s: 10 }, { lt: 20, s: 7 }, { lt: 30, s: 4 }, { lt: Infinity, s: 1 }]) },
      { k: "EV/EBITDA", v: evEbitda, s: score(evEbitda, [{ lt: 8, s: 10 }, { lt: 15, s: 7 }, { lt: 25, s: 4 }, { lt: Infinity, s: 1 }]) },
      { k: "PEG", v: peg, s: peg != null && peg > 0 ? score(peg, [{ lt: 1, s: 10 }, { lt: 1.5, s: 7 }, { lt: 2, s: 4 }, { lt: Infinity, s: 1 }]) : 5 },
    ];
    const card1Score = card1Sub.reduce((a, b) => a + b.s, 0) / card1Sub.length;

    const card2Sub = [
      { k: "Gross Margin", v: grossMargins, s: sBand(grossMargins, 0.15, 0.3, 0.5) },
      { k: "ROE", v: roe, s: sBand(roe, 0, 0.1, 0.2) },
      { k: "Debt/Equity", v: deNorm, s: score(deNorm, [{ lt: 0.3, s: 10 }, { lt: 1, s: 7 }, { lt: 2, s: 4 }, { lt: Infinity, s: 1 }]) },
      { k: "FCF Yield", v: fcfYield, s: sBand(fcfYield, 0, 0.02, 0.05) },
    ];
    const card2Score = card2Sub.reduce((a, b) => a + b.s, 0) / card2Sub.length;

    const card3Sub = [
      { k: "Revenue Growth YoY", v: revenueGrowth ?? manualRevYoY, s: sBand(revenueGrowth ?? manualRevYoY, 0, 0.1, 0.2) },
      { k: "Earnings Growth YoY", v: earningsGrowth, s: sBand(earningsGrowth, 0, 0.05, 0.15) },
    ];
    const card3Score = card3Sub.reduce((a, b) => a + b.s, 0) / card3Sub.length;

    const card4Sub = [
      { k: "RSI (14d)", v: rsiVal, s: rsiVal == null ? 5 : rsiVal >= 40 && rsiVal <= 60 ? 10 : (rsiVal >= 30 && rsiVal < 40) || (rsiVal > 60 && rsiVal <= 70) ? 6 : 3 },
      { k: "Price vs 200d MA", v: priceVs200, s: priceVs200 == null ? 5 : priceVs200 > 0.1 ? 4 : priceVs200 > 0 ? 10 : priceVs200 > -0.1 ? 7 : 3 },
    ];
    const card4Score = card4Sub.reduce((a, b) => a + b.s, 0) / card4Sub.length;

    const card5Sub = [
      { k: "Analyst Consensus", v: consensusScore, s: consensusScore == null ? 5 : consensusScore <= 1.5 ? 10 : consensusScore <= 2.5 ? 7 : consensusScore <= 3.5 ? 4 : 1 },
      { k: "Short Interest", v: shortPct, s: shortPct == null ? 5 : shortPct < 0.03 ? 10 : shortPct < 0.07 ? 7 : shortPct < 0.15 ? 4 : 1 },
      { k: "Upside to Target", v: upside, s: upside == null ? 5 : upside > 0.3 ? 10 : upside > 0.15 ? 7 : upside > 0 ? 4 : 1 },
    ];
    const card5Score = card5Sub.reduce((a, b) => a + b.s, 0) / card5Sub.length;

    const card6Sub = [
      { k: "Beta (1y)", v: beta, s: beta == null ? 5 : beta < 0.8 ? 10 : beta < 1.2 ? 8 : beta < 1.8 ? 5 : 2 },
      { k: "Hist Volatility 30d", v: histVol, s: histVol == null ? 5 : histVol < 0.2 ? 10 : histVol < 0.35 ? 7 : histVol < 0.6 ? 4 : 1 },
    ];
    const card6Score = card6Sub.reduce((a, b) => a + b.s, 0) / card6Sub.length;

    // ESG card (optional)
    const card7Sub = [
      { k: "Total ESG Risk", v: esgData.total, s: esgData.total == null ? 5 : esgData.total < 15 ? 10 : esgData.total < 25 ? 7 : esgData.total < 35 ? 4 : 1 },
      { k: "Controversy Level", v: esgData.controversy, s: esgData.controversy == null ? 5 : esgData.controversy <= 1 ? 10 : esgData.controversy <= 2 ? 7 : esgData.controversy <= 3 ? 4 : 1 },
    ];
    const card7Score = card7Sub.reduce((a, b) => a + b.s, 0) / card7Sub.length;

    const cards = [
      { id: "valuation", title: "Valuation", weight: 22, score: card1Score, indicators: card1Sub, source: "Yahoo Finance", extras: { marketCap, ps, priceToBook, enterpriseValue } },
      { id: "quality", title: "Financial Quality", weight: 22, score: card2Score, indicators: card2Sub, source: "Yahoo Finance", extras: { opMargin, profitMargins, roa, currentRatio, quickRatio, freeCashflow, totalCash, totalDebt, revenuePerShare, eps } },
      { id: "growth", title: "Growth", weight: 18, score: card3Score, indicators: card3Sub, source: "Yahoo Finance", extras: { earningsQGrowth, revenueQGrowth, manualRevYoY, nextEPSEst, nextRevEst } },
      { id: "technical", title: "Momentum / Technical", weight: 10, score: card4Score, indicators: card4Sub, source: "Yahoo Chart API (computed)", extras: { macd: macdVal, priceVs50, pos52w, fiftyDayAvg, twoHundredDayAvg, bollinger: bb, histVol } },
      { id: "sentiment", title: "Sentiment", weight: 10, score: card5Score, indicators: card5Sub, source: "Yahoo Finance", extras: { totalAnalysts, consensusLabel, targetPrice, shortRatio, heldPctInst, heldPctInsiders } },
      { id: "macro", title: "Risk Metrics", weight: 10, score: card6Score, indicators: card6Sub, source: "Yahoo + computed", extras: { histVol, avgVol, avgVol10 } },
      { id: "esg", title: "ESG", weight: 8, score: card7Score, indicators: card7Sub, source: "Yahoo ESG", extras: { env: esgData.env, social: esgData.social, gov: esgData.gov, perf: esgData.perf } },
    ];

    const composite = Math.round(
      (cards.reduce((s, c) => s + c.score * c.weight, 0) / cards.reduce((s, c) => s + c.weight, 0)) * 10,
    );

    // ─── Risk Radar (10 = highest risk) ───
    const marketRisk = beta != null ? Math.min(10, Math.max(0, (beta - 0.5) * 5)) : 5;
    const finRisk = deNorm != null ? Math.min(10, Math.max(0, deNorm * 3)) : 5;
    const valRisk = trailingPE != null ? Math.min(10, Math.max(0, (trailingPE - 10) / 4)) : 5;
    const sensitiveSectors = ["Technology", "Healthcare", "Energy", "Financial Services"];
    const regRisk = company.sector && sensitiveSectors.includes(company.sector) ? 7 : 4;
    const liquidityRisk = (() => {
      const adv = (avgVol10 || 0) * (currentPrice || 0);
      if (!adv) return 5;
      if (adv < 10e6) return 9;
      if (adv < 100e6) return 6;
      if (adv < 1e9) return 3;
      return 1;
    })();
    const sentimentRisk = shortPct != null ? Math.min(10, shortPct * 50) : 5;
    const esgRisk = esgData.total != null ? Math.min(10, esgData.total / 4) : 5;

    const radar = [
      { axis: "Market", value: +marketRisk.toFixed(1) },
      { axis: "Financial", value: +finRisk.toFixed(1) },
      { axis: "Valuation", value: +valRisk.toFixed(1) },
      { axis: "Regulatory", value: +regRisk.toFixed(1) },
      { axis: "Liquidity", value: +liquidityRisk.toFixed(1) },
      { axis: "Sentiment", value: +sentimentRisk.toFixed(1) },
      { axis: "ESG", value: +esgRisk.toFixed(1) },
    ];

    // ─── Heuristic risk factors (used until/unless AI runs) ───
    const risks: { category: string; label: string; description: string; severity: "high" | "medium" | "low"; source: string }[] = [];
    if (beta != null && beta > 1.3) risks.push({
      category: "Market", label: "High Beta",
      description: `Beta of ${beta.toFixed(2)} — moves ${((beta - 1) * 100).toFixed(0)}% more than the market.`,
      severity: beta > 1.8 ? "high" : "medium", source: "Yahoo Finance",
    });
    if (trailingPE != null && trailingPE > 30 && dgs10 != null && dgs10 > 4) risks.push({
      category: "Market", label: "Rate Sensitivity",
      description: `High P/E (${trailingPE.toFixed(1)}) is vulnerable to elevated rates (10Y at ${dgs10.toFixed(2)}%).`,
      severity: "medium", source: "FRED + Yahoo",
    });
    if (trailingPE != null && trailingPE > 35) risks.push({
      category: "Valuation", label: "Premium Valuation",
      description: `P/E of ${trailingPE.toFixed(1)} is well above market average; multiple compression risk.`,
      severity: "high", source: "Yahoo Finance",
    });
    if (deNorm != null && deNorm > 2) risks.push({
      category: "Financial", label: "Debt Stress",
      description: `Debt/Equity of ${deNorm.toFixed(2)} is elevated; leverage risk.`,
      severity: "high", source: "Yahoo Finance",
    });
    if (fcfYield != null && fcfYield < 0) risks.push({
      category: "Financial", label: "Negative FCF",
      description: "Free cash flow is negative; the company is burning cash.",
      severity: "high", source: "Yahoo Finance",
    });
    if (company.sector && sensitiveSectors.includes(company.sector)) {
      risks.push({
        category: "Regulatory", label: "Regulatory Exposure",
        description: `${company.sector} sector faces ongoing regulatory and antitrust scrutiny.`,
        severity: "medium", source: "Sector classification",
      });
    }
    if (shortPct != null && shortPct > 0.1) risks.push({
      category: "Sentiment", label: "Elevated Short Interest",
      description: `${(shortPct * 100).toFixed(1)}% of float sold short; bearish positioning.`,
      severity: shortPct > 0.2 ? "high" : "medium", source: "Yahoo Finance",
    });
    const adv = (avgVol10 || 0) * (currentPrice || 0);
    if (adv && adv < 10e6) risks.push({
      category: "Liquidity", label: "Low Liquidity",
      description: `Avg daily $ volume of ~$${(adv / 1e6).toFixed(1)}M makes large positions hard to exit.`,
      severity: "medium", source: "Yahoo Finance",
    });
    if (esgData.controversy != null && esgData.controversy >= 3) risks.push({
      category: "ESG", label: "ESG Controversy",
      description: `Yahoo ESG controversy level ${esgData.controversy}/5 — material reputational/regulatory risk.`,
      severity: esgData.controversy >= 4 ? "high" : "medium", source: "Yahoo ESG",
    });

    // ─── Heuristic summary (until AI runs) ───
    const positives: string[] = [];
    const negatives: string[] = [];
    if (card2Score >= 7) positives.push("strong fundamentals");
    if (card3Score >= 7) positives.push("solid growth");
    if (card1Score <= 4) negatives.push("rich valuation");
    if (card4Score <= 4) negatives.push("weak technicals");
    if (card5Score >= 7) positives.push("positive analyst sentiment");
    let summary = "";
    if (composite >= 65) summary = `Attractive risk profile: ${positives.slice(0, 2).join(" and ") || "balanced metrics"}.`;
    else if (composite >= 35) summary = `Mixed picture${positives.length ? ` — ${positives[0]}` : ""}${negatives.length ? ` offset by ${negatives.slice(0, 2).join(" and ")}` : ""}.`;
    else summary = `Elevated risk: ${negatives.slice(0, 2).join(" and ") || "weak across multiple dimensions"}.`;

    return {
      ticker, company, sources,
      lastUpdated: new Date().toISOString(),
      price: {
        current: currentPrice, high52, low52, dayHigh, dayLow,
        volume, avgVol, avgVol10, fiftyDayAvg, twoHundredDayAvg,
        change, changePct,
      },
      priceChart,
      composite,
      summary,
      cards,
      radar,
      risks,
      crossCheck,
      esg: esgData,
      macro: {
        fedFunds, treas10y: dgs10, cpi, dxy, vix,
      },
      analyst: {
        ratings: recTrend.slice(0, 6).map((rt: any) => ({
          date: rt.period || "",
          buy: (rt.buy ?? 0) + (rt.strongBuy ?? 0),
          hold: rt.hold ?? 0,
          sell: (rt.sell ?? 0) + (rt.strongSell ?? 0),
        })),
        targetPrice, upside, consensusLabel, totalAnalysts,
        nextEarnings, nextEPSEst, nextRevEst,
        upgrades: recentUpgrades,
      },
      ownership: {
        topHolders,
        heldPctInst,
        heldPctInsiders,
        recentInsiderTx,
      },
      filings,
    };
  });

export type AnalysisResult = Awaited<ReturnType<typeof analyzeStock>>;
