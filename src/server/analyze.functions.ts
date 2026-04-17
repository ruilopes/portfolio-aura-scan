import { createServerFn } from "@tanstack/react-start";

const FMP = "https://financialmodelingprep.com/api/v3";
const FMP_STABLE = "https://financialmodelingprep.com/stable";
const YAHOO = "https://query1.finance.yahoo.com";
const ALPHA = "https://www.alphavantage.co/query";
const FRED = "https://api.stlouisfed.org/fred/series/observations";
const SEC = "https://data.sec.gov";

const UA = { "User-Agent": "StockAnalysisDashboard/1.0 contact@example.com" };

async function safeFetch(url: string, init?: RequestInit): Promise<any> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    const text = await r.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } catch {
    return null;
  }
}

const fmpUrl = (path: string, key: string, extra = "") =>
  `${FMP}${path}?apikey=${key}${extra ? `&${extra}` : ""}`;

// ---- Yahoo chart (6 months daily) ----
async function fetchYahooChart(symbol: string) {
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo`;
  const data = await safeFetch(url, { headers: UA });
  if (!data?.chart?.result?.[0]) return null;
  const r = data.chart.result[0];
  const ts: number[] = r.timestamp || [];
  const closes: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
  const meta = r.meta || {};
  const series = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: closes[i],
  })).filter(p => p.close != null) as { date: string; close: number }[];
  return { meta, series };
}

async function fetchYahooQuote(symbol: string) {
  const url = `${YAHOO}/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const data = await safeFetch(url, { headers: UA });
  return data?.quoteResponse?.result?.[0] || null;
}

// ---- Technical calculations ----
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
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function macd(values: number[]): { macd: number; signal: number; hist: number } | null {
  if (values.length < 35) return null;
  const ema = (vals: number[], p: number) => {
    const k = 2 / (p + 1);
    let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
    const out = [e];
    for (let i = p; i < vals.length; i++) {
      e = vals[i] * k + e * (1 - k);
      out.push(e);
    }
    return out;
  };
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  // align tails
  const offset = e12.length - e26.length;
  const macdLine = e26.map((v, i) => e12[i + offset] - v);
  const sig = ema(macdLine, 9);
  const m = macdLine[macdLine.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, hist: m - s };
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

// ---- FRED ----
async function fetchFred(seriesId: string, key: string) {
  if (!key) return null;
  const url = `${FRED}?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=2`;
  const data = await safeFetch(url);
  const obs = data?.observations?.[0];
  if (!obs || obs.value === ".") return null;
  return parseFloat(obs.value);
}

// ---- SEC EDGAR ----
async function fetchSECFilings(cik: string) {
  if (!cik) return null;
  const padded = cik.padStart(10, "0");
  const data = await safeFetch(`${SEC}/submissions/CIK${padded}.json`, { headers: UA });
  if (!data?.filings?.recent) return null;
  const r = data.filings.recent;
  const out: { form: string; filingDate: string; accession: string; primaryDoc: string }[] = [];
  for (let i = 0; i < (r.form?.length || 0) && out.length < 10; i++) {
    if (["10-K", "10-Q", "8-K"].includes(r.form[i])) {
      out.push({
        form: r.form[i],
        filingDate: r.filingDate[i],
        accession: r.accessionNumber[i],
        primaryDoc: r.primaryDocument[i],
      });
    }
  }
  return out.slice(0, 5);
}

// ---- Sector ETF map ----
const SECTOR_ETF: Record<string, string> = {
  "Technology": "XLK",
  "Health Care": "XLV", "Healthcare": "XLV",
  "Financial Services": "XLF", "Financials": "XLF",
  "Consumer Cyclical": "XLY", "Consumer Discretionary": "XLY",
  "Consumer Defensive": "XLP", "Consumer Staples": "XLP",
  "Energy": "XLE",
  "Industrials": "XLI",
  "Utilities": "XLU",
  "Real Estate": "XLRE",
  "Basic Materials": "XLB", "Materials": "XLB",
  "Communication Services": "XLC",
};

async function fetch30dPerf(symbol: string): Promise<number | null> {
  const url = `${YAHOO}/v8/finance/chart/${symbol}?interval=1d&range=1mo`;
  const d = await safeFetch(url, { headers: UA });
  const closes: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((x: any) => x != null) || [];
  if (closes.length < 2) return null;
  return (closes[closes.length - 1] - closes[0]) / closes[0];
}

export const analyzeStock = createServerFn({ method: "POST" })
  .inputValidator((d: { ticker: string }) => {
    const t = (d?.ticker || "").trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(t)) throw new Error("Invalid ticker");
    return { ticker: t };
  })
  .handler(async ({ data }) => {
    const { ticker } = data;
    const fmpKey = process.env.FMP_API_KEY || "";
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY || "";
    const fredKey = process.env.FRED_API_KEY || ""; // optional

    const sources = { fmp: false, yahoo: false, alpha: false, fred: false, sec: false };

    // ---- Parallel fetches ----
    const [
      profileArr, ratiosArr, keyMetricsArr, incomeArr, balanceArr, cashflowArr,
      growthArr, estimatesArr, surprisesArr, recommendsArr, priceTargetArr,
      institutionalArr, insiderArr, sectorPerf,
      yahooChart, yahooQuote,
    ] = await Promise.all([
      fmpKey ? safeFetch(fmpUrl(`/profile/${ticker}`, fmpKey)) : null,
      fmpKey ? safeFetch(fmpUrl(`/ratios-ttm/${ticker}`, fmpKey)) : null,
      fmpKey ? safeFetch(fmpUrl(`/key-metrics-ttm/${ticker}`, fmpKey)) : null,
      fmpKey ? safeFetch(fmpUrl(`/income-statement/${ticker}`, fmpKey, "limit=8")) : null,
      fmpKey ? safeFetch(fmpUrl(`/balance-sheet-statement/${ticker}`, fmpKey, "limit=4")) : null,
      fmpKey ? safeFetch(fmpUrl(`/cash-flow-statement/${ticker}`, fmpKey, "limit=8")) : null,
      fmpKey ? safeFetch(fmpUrl(`/financial-growth/${ticker}`, fmpKey, "limit=4")) : null,
      fmpKey ? safeFetch(fmpUrl(`/analyst-estimates/${ticker}`, fmpKey, "limit=4")) : null,
      fmpKey ? safeFetch(fmpUrl(`/earnings-surprises/${ticker}`, fmpKey)) : null,
      fmpKey ? safeFetch(fmpUrl(`/analyst-stock-recommendations/${ticker}`, fmpKey)) : null,
      fmpKey ? safeFetch(fmpUrl(`/price-target-consensus`, fmpKey, `symbol=${ticker}`)) : null,
      fmpKey ? safeFetch(fmpUrl(`/institutional-holder/${ticker}`, fmpKey)) : null,
      fmpKey ? safeFetch(fmpUrl(`/insider-trading`, fmpKey, `symbol=${ticker}&limit=50`)) : null,
      fmpKey ? safeFetch(fmpUrl(`/sectors-performance`, fmpKey)) : null,
      fetchYahooChart(ticker),
      fetchYahooQuote(ticker),
    ]);

    if (profileArr || ratiosArr || incomeArr) sources.fmp = true;
    if (yahooChart || yahooQuote) sources.yahoo = true;

    const profile = Array.isArray(profileArr) ? profileArr[0] : null;
    const ratios = Array.isArray(ratiosArr) ? ratiosArr[0] : null;
    const keyMetrics = Array.isArray(keyMetricsArr) ? keyMetricsArr[0] : null;
    const incomes: any[] = Array.isArray(incomeArr) ? incomeArr : [];
    const balances: any[] = Array.isArray(balanceArr) ? balanceArr : [];
    const cashflows: any[] = Array.isArray(cashflowArr) ? cashflowArr : [];
    const growths: any[] = Array.isArray(growthArr) ? growthArr : [];
    const estimates: any[] = Array.isArray(estimatesArr) ? estimatesArr : [];
    const surprises: any[] = Array.isArray(surprisesArr) ? surprisesArr : [];
    const recommends: any[] = Array.isArray(recommendsArr) ? recommendsArr : [];
    const priceTarget = Array.isArray(priceTargetArr) ? priceTargetArr[0] : null;
    const institutional: any[] = Array.isArray(institutionalArr) ? institutionalArr : [];
    const insider: any[] = Array.isArray(insiderArr) ? insiderArr : [];

    // Company info
    const company = {
      name: profile?.companyName || yahooQuote?.longName || yahooQuote?.shortName || ticker,
      sector: profile?.sector || yahooQuote?.sector || null,
      industry: profile?.industry || yahooQuote?.industry || null,
      country: profile?.country || null,
      exchange: profile?.exchangeShortName || yahooQuote?.exchange || null,
      cik: profile?.cik || null,
      website: profile?.website || null,
      description: profile?.description || null,
      logo: profile?.image || null,
    };

    // Price series
    const series = yahooChart?.series || [];
    const closes = series.map((p: any) => p.close);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const priceChartData = series.map((p: any, i: number) => ({
      date: p.date, close: p.close, sma50: sma50[i], sma200: sma200[i],
    }));

    const currentPrice = profile?.price ?? yahooQuote?.regularMarketPrice ?? closes[closes.length - 1] ?? null;
    const meta = yahooChart?.meta || {};
    const high52 = meta.fiftyTwoWeekHigh ?? yahooQuote?.fiftyTwoWeekHigh ?? Math.max(...closes);
    const low52 = meta.fiftyTwoWeekLow ?? yahooQuote?.fiftyTwoWeekLow ?? Math.min(...closes);

    // Technical
    const rsiVal = rsi(closes, 14);
    const macdVal = macd(closes);
    const sma50Last = sma50[sma50.length - 1];
    const sma200Last = sma200[sma200.length - 1];
    const priceVs50 = sma50Last && currentPrice ? (currentPrice - sma50Last) / sma50Last : null;
    const priceVs200 = sma200Last && currentPrice ? (currentPrice - sma200Last) / sma200Last : null;
    const pos52w = currentPrice && high52 && low52 ? (currentPrice - low52) / (high52 - low52) : null;

    // Returns / volatility
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const last30Rets = rets.slice(-30);
    const histVol = stddev(last30Rets) * Math.sqrt(252);

    // Alpha Vantage backup RSI
    let alphaRSI: number | null = null;
    if (alphaKey && rsiVal == null) {
      const ad = await safeFetch(`${ALPHA}?function=RSI&symbol=${ticker}&interval=daily&time_period=14&series_type=close&apikey=${alphaKey}`);
      const ts = ad?.["Technical Analysis: RSI"];
      if (ts) {
        const firstKey = Object.keys(ts)[0];
        alphaRSI = parseFloat(ts[firstKey]?.RSI);
        sources.alpha = true;
      }
    }

    // Valuation
    const pe = ratios?.peRatioTTM ?? profile?.pe ?? yahooQuote?.trailingPE ?? null;
    const fwdPE = yahooQuote?.forwardPE ?? null;
    const pb = ratios?.priceToBookRatioTTM ?? null;
    const ps = ratios?.priceToSalesRatioTTM ?? null;
    const evEbitda = keyMetrics?.enterpriseValueOverEBITDATTM ?? null;
    const peg = ratios?.pegRatioTTM ?? yahooQuote?.pegRatio ?? null;

    // Quality
    const grossMargin = ratios?.grossProfitMarginTTM ?? null;
    const opMargin = ratios?.operatingProfitMarginTTM ?? null;
    const netMargin = ratios?.netProfitMarginTTM ?? null;
    const roe = ratios?.returnOnEquityTTM ?? null;
    const roa = ratios?.returnOnAssetsTTM ?? null;
    const roic = keyMetrics?.roicTTM ?? null;
    const de = ratios?.debtEquityRatioTTM ?? keyMetrics?.debtToEquityTTM ?? null;
    const currentRatio = ratios?.currentRatioTTM ?? null;
    const fcfYield = keyMetrics?.freeCashFlowYieldTTM ?? null;

    // Growth
    const revGrowth = growths[0]?.revenueGrowth ?? null;
    const epsGrowth = growths[0]?.epsgrowth ?? null;
    const fcfGrowth = growths[0]?.freeCashFlowGrowth ?? null;
    let revCAGR3 = null;
    if (incomes.length >= 4) {
      const recent = incomes[0]?.revenue;
      const old = incomes[3]?.revenue;
      if (recent && old && old > 0) revCAGR3 = Math.pow(recent / old, 1 / 3) - 1;
    }
    const nextEPSEst = estimates[0]?.estimatedEpsAvg ?? null;

    // QoQ revenue
    let revQoQ = null;
    if (incomes.length >= 2 && incomes[0]?.revenue && incomes[1]?.revenue) {
      revQoQ = (incomes[0].revenue - incomes[1].revenue) / incomes[1].revenue;
    }

    // Sentiment
    const lastRec = recommends[0] || {};
    const totalRecs = (lastRec.analystRatingsbuy || 0) + (lastRec.analystRatingsStrongBuy || 0)
      + (lastRec.analystRatingsHold || 0) + (lastRec.analystRatingsSell || 0) + (lastRec.analystRatingsStrongSell || 0);
    let consensusScore: number | null = null;
    if (totalRecs > 0) {
      consensusScore = (
        (lastRec.analystRatingsStrongBuy || 0) * 1 +
        (lastRec.analystRatingsbuy || 0) * 2 +
        (lastRec.analystRatingsHold || 0) * 3 +
        (lastRec.analystRatingsSell || 0) * 4 +
        (lastRec.analystRatingsStrongSell || 0) * 5
      ) / totalRecs;
    }
    const consensusLabel =
      consensusScore == null ? null
        : consensusScore <= 1.5 ? "Strong Buy"
          : consensusScore <= 2.5 ? "Buy"
            : consensusScore <= 3.5 ? "Hold"
              : consensusScore <= 4.5 ? "Sell" : "Strong Sell";
    const targetPrice = priceTarget?.targetConsensus ?? yahooQuote?.targetMeanPrice ?? null;
    const upside = targetPrice && currentPrice ? (targetPrice - currentPrice) / currentPrice : null;
    const shortPct = yahooQuote?.shortPercentOfFloat ?? null;
    const shortRatio = yahooQuote?.shortRatio ?? null;
    const instOwn = institutional.length > 0
      ? institutional.slice(0, 50).reduce((s, h) => s + (h.shares || 0), 0) / (yahooQuote?.sharesOutstanding || 1)
      : (yahooQuote?.heldPercentInstitutions ?? null);

    // Insider net buying (last 90 days)
    let insiderNet = 0, insiderCount = 0;
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    for (const i of insider) {
      const d = new Date(i.transactionDate || i.filingDate || 0).getTime();
      if (d > cutoff) {
        const shares = i.securitiesTransacted || 0;
        const isBuy = (i.acquistionOrDisposition || i.acquisitionOrDisposition || "").toUpperCase() === "A";
        insiderNet += (isBuy ? 1 : -1) * shares;
        insiderCount++;
      }
    }

    // Risk / Macro
    const beta = profile?.beta ?? yahooQuote?.beta ?? null;
    const earningsBeats = surprises.slice(0, 4).filter(s => (s.actualEarningResult ?? 0) > (s.estimatedEarning ?? 0)).length;
    const earningsTotal = Math.min(surprises.length, 4);

    // Sector ETF perf
    const sectorEtf = company.sector ? SECTOR_ETF[company.sector] : null;
    let sectorEtfPerf30: number | null = null, spyPerf30: number | null = null;
    [sectorEtfPerf30, spyPerf30] = await Promise.all([
      sectorEtf ? fetch30dPerf(sectorEtf) : Promise.resolve(null),
      fetch30dPerf("SPY"),
    ]);

    // FRED macro
    const [fedFunds, treas10y, cpi] = fredKey ? await Promise.all([
      fetchFred("FEDFUNDS", fredKey),
      fetchFred("DGS10", fredKey),
      fetchFred("CPIAUCSL", fredKey),
    ]) : [null, null, null];
    if (fedFunds != null || treas10y != null) sources.fred = true;
    // VIX, DXY via Yahoo
    const [vix, dxy] = await Promise.all([fetch30dPerf("^VIX"), fetch30dPerf("DX-Y.NYB")]);
    const [vixQuote, dxyQuote] = await Promise.all([fetchYahooQuote("^VIX"), fetchYahooQuote("DX-Y.NYB")]);

    // SEC filings
    const cikRaw = company.cik ? String(company.cik).replace(/\D/g, "") : "";
    const filings = cikRaw ? await fetchSECFilings(cikRaw) : null;
    if (filings) sources.sec = true;

    // ---- Card scoring ----
    const valScores = [
      { label: "P/E TTM", value: pe, score: 0 },
    ];
    const card1Sub = [
      { k: "P/E TTM", v: pe, s: pe != null ? (pe < 15 ? 10 : pe < 25 ? 7 : pe < 35 ? 4 : 1) : 5 },
      { k: "Forward P/E", v: fwdPE, s: fwdPE != null ? (fwdPE < 12 ? 10 : fwdPE < 20 ? 7 : fwdPE < 30 ? 4 : 1) : 5 },
      { k: "EV/EBITDA", v: evEbitda, s: evEbitda != null ? (evEbitda < 8 ? 10 : evEbitda < 15 ? 7 : evEbitda < 25 ? 4 : 1) : 5 },
      { k: "PEG", v: peg, s: peg != null && peg > 0 ? (peg < 1 ? 10 : peg < 1.5 ? 7 : peg < 2 ? 4 : 1) : 5 },
    ];
    const card1Score = card1Sub.reduce((a, b) => a + b.s, 0) / card1Sub.length;

    const card2Sub = [
      { k: "Gross Margin", v: grossMargin, s: grossMargin != null ? (grossMargin > 0.5 ? 10 : grossMargin > 0.3 ? 7 : grossMargin > 0.15 ? 4 : 1) : 5 },
      { k: "ROE", v: roe, s: roe != null ? (roe > 0.2 ? 10 : roe > 0.1 ? 7 : roe > 0 ? 4 : 1) : 5 },
      { k: "Debt/Equity", v: de, s: de != null ? (de < 0.3 ? 10 : de < 1 ? 7 : de < 2 ? 4 : 1) : 5 },
      { k: "FCF Yield", v: fcfYield, s: fcfYield != null ? (fcfYield > 0.05 ? 10 : fcfYield > 0.02 ? 7 : fcfYield > 0 ? 4 : 1) : 5 },
    ];
    const card2Score = card2Sub.reduce((a, b) => a + b.s, 0) / card2Sub.length;

    const card3Sub = [
      { k: "Revenue Growth YoY", v: revGrowth, s: revGrowth != null ? (revGrowth > 0.2 ? 10 : revGrowth > 0.1 ? 7 : revGrowth > 0 ? 4 : 1) : 5 },
      { k: "EPS Growth YoY", v: epsGrowth, s: epsGrowth != null ? (epsGrowth > 0.15 ? 10 : epsGrowth > 0.05 ? 7 : epsGrowth > 0 ? 4 : 1) : 5 },
    ];
    const card3Score = card3Sub.reduce((a, b) => a + b.s, 0) / card3Sub.length;

    const rsiUsed = rsiVal ?? alphaRSI;
    const card4Sub = [
      { k: "RSI (14d)", v: rsiUsed, s: rsiUsed != null ? (rsiUsed >= 40 && rsiUsed <= 60 ? 10 : (rsiUsed >= 30 && rsiUsed < 40) || (rsiUsed > 60 && rsiUsed <= 70) ? 6 : 3) : 5 },
      { k: "Price vs 200d MA", v: priceVs200, s: priceVs200 != null ? (priceVs200 > 0.1 ? 4 : priceVs200 > 0 ? 10 : priceVs200 > -0.1 ? 7 : 3) : 5 },
    ];
    const card4Score = card4Sub.reduce((a, b) => a + b.s, 0) / card4Sub.length;

    const card5Sub = [
      { k: "Analyst Consensus", v: consensusScore, s: consensusScore != null ? (consensusScore <= 1.5 ? 10 : consensusScore <= 2.5 ? 7 : consensusScore <= 3.5 ? 4 : 1) : 5 },
      { k: "Short Interest", v: shortPct, s: shortPct != null ? (shortPct < 0.03 ? 10 : shortPct < 0.07 ? 7 : shortPct < 0.15 ? 4 : 1) : 5 },
      { k: "Upside to Target", v: upside, s: upside != null ? (upside > 0.3 ? 10 : upside > 0.15 ? 7 : upside > 0 ? 4 : 1) : 5 },
    ];
    const card5Score = card5Sub.reduce((a, b) => a + b.s, 0) / card5Sub.length;

    const card6Sub = [
      { k: "Beta (1y)", v: beta, s: beta != null ? (beta < 0.8 ? 10 : beta < 1.2 ? 8 : beta < 1.8 ? 5 : 2) : 5 },
      { k: "Earnings Beat Rate", v: earningsTotal > 0 ? earningsBeats / earningsTotal : null, s: earningsTotal > 0 ? (earningsBeats / earningsTotal >= 1 ? 10 : earningsBeats / earningsTotal >= 0.75 ? 7 : earningsBeats / earningsTotal >= 0.5 ? 4 : 1) : 5 },
    ];
    const card6Score = card6Sub.reduce((a, b) => a + b.s, 0) / card6Sub.length;

    const cards = [
      { id: "valuation", title: "Valuation", weight: 25, score: card1Score, indicators: card1Sub, source: "FMP + Yahoo" },
      { id: "quality", title: "Financial Quality", weight: 25, score: card2Score, indicators: card2Sub, source: "FMP", extras: { opMargin, netMargin, roa, roic, currentRatio, ps, pb } },
      { id: "growth", title: "Growth", weight: 20, score: card3Score, indicators: card3Sub, source: "FMP", extras: { fcfGrowth, revQoQ, revCAGR3, nextEPSEst } },
      { id: "technical", title: "Momentum / Technical", weight: 10, score: card4Score, indicators: card4Sub, source: "Yahoo + Alpha Vantage", extras: { macd: macdVal, priceVs50, pos52w } },
      { id: "sentiment", title: "Sentiment", weight: 10, score: card5Score, indicators: card5Sub, source: "FMP + Yahoo", extras: { totalAnalysts: totalRecs, consensusLabel, targetPrice, shortRatio, instOwn, insiderNet, insiderCount } },
      { id: "macro", title: "Macro / Risk Metrics", weight: 10, score: card6Score, indicators: card6Sub, source: "Yahoo + FRED", extras: { histVol, sectorEtfPerf30, spyPerf30 } },
    ];

    const composite = Math.round(
      cards.reduce((s, c) => s + c.score * c.weight, 0) / cards.reduce((s, c) => s + c.weight, 0) * 10
    );

    // ---- Risk Radar ----
    // Each axis 0-10 (10 = highest risk)
    const marketRisk = beta != null ? Math.min(10, Math.max(0, (beta - 0.5) * 5)) : 5;
    const sectorRisk = sectorEtfPerf30 != null && spyPerf30 != null
      ? Math.min(10, Math.max(0, ((spyPerf30 - sectorEtfPerf30) * 100) + 5)) : 5;
    const finRisk = de != null ? Math.min(10, Math.max(0, de * 3)) : 5;
    const valRisk = pe != null ? Math.min(10, Math.max(0, (pe - 10) / 4)) : 5;
    const sensitiveSectors = ["Technology", "Health Care", "Healthcare", "Energy", "Financial Services"];
    const regRisk = company.sector && sensitiveSectors.includes(company.sector) ? 7 : 4;
    const liquidityRisk = (() => {
      const adv = (yahooQuote?.averageDailyVolume10Day || 0) * (currentPrice || 0);
      if (!adv) return 5;
      if (adv < 10e6) return 9;
      if (adv < 100e6) return 6;
      if (adv < 1e9) return 3;
      return 1;
    })();
    const radar = [
      { axis: "Market", value: +marketRisk.toFixed(1) },
      { axis: "Sector", value: +sectorRisk.toFixed(1) },
      { axis: "Financial", value: +finRisk.toFixed(1) },
      { axis: "Valuation", value: +valRisk.toFixed(1) },
      { axis: "Regulatory", value: +regRisk.toFixed(1) },
      { axis: "Liquidity", value: +liquidityRisk.toFixed(1) },
    ];

    // ---- Risk factors triggered ----
    const risks: { category: string; label: string; description: string; severity: "high" | "medium" | "low"; source: string }[] = [];
    if (beta != null && beta > 1.3) risks.push({
      category: "Market", label: "High Beta",
      description: `Beta of ${beta.toFixed(2)} indicates the stock moves ${((beta - 1) * 100).toFixed(0)}% more than the market.`,
      severity: beta > 1.8 ? "high" : "medium", source: "Yahoo Finance",
    });
    if (pe != null && pe > 30 && treas10y != null && treas10y > 4) risks.push({
      category: "Market", label: "Interest Rate Sensitivity",
      description: `High P/E (${pe.toFixed(1)}) makes valuation vulnerable to elevated rates (10Y at ${treas10y.toFixed(2)}%).`,
      severity: "medium", source: "FRED + FMP",
    });
    if (sectorEtfPerf30 != null && spyPerf30 != null && (spyPerf30 - sectorEtfPerf30) > 0.05) risks.push({
      category: "Sector", label: "Sector Rotation",
      description: `Sector ETF (${sectorEtf}) underperforming SPY by ${((spyPerf30 - sectorEtfPerf30) * 100).toFixed(1)}% over 30 days.`,
      severity: "medium", source: "Yahoo Finance",
    });
    if (pe != null && pe > 35) risks.push({
      category: "Valuation", label: "Premium Valuation",
      description: `P/E of ${pe.toFixed(1)} is well above market average; multiple compression risk.`,
      severity: "high", source: "FMP",
    });
    if (de != null && de > 2) risks.push({
      category: "Financial", label: "Debt Stress",
      description: `Debt/Equity ratio of ${de.toFixed(2)} is elevated; leverage risk.`,
      severity: "high", source: "FMP",
    });
    if (fcfYield != null && fcfYield < 0) risks.push({
      category: "Financial", label: "Negative FCF",
      description: "Free cash flow is negative; the company is burning cash.",
      severity: "high", source: "FMP",
    });
    if (earningsTotal >= 4 && earningsBeats < 2) risks.push({
      category: "Earnings", label: "Earnings Misses",
      description: `Missed estimates in ${earningsTotal - earningsBeats} of last ${earningsTotal} quarters.`,
      severity: earningsBeats === 0 ? "high" : "medium", source: "FMP",
    });
    if (company.sector && ["Technology", "Health Care", "Healthcare", "Energy"].includes(company.sector)) {
      risks.push({
        category: "Regulatory", label: "Regulatory Exposure",
        description: `${company.sector} sector faces ongoing regulatory scrutiny and potential antitrust action.`,
        severity: "medium", source: "Sector classification",
      });
    }
    if (shortPct != null && shortPct > 0.1) risks.push({
      category: "Sentiment", label: "Elevated Short Interest",
      description: `${(shortPct * 100).toFixed(1)}% of float is sold short; bearish positioning.`,
      severity: shortPct > 0.2 ? "high" : "medium", source: "Yahoo Finance",
    });
    const adv = (yahooQuote?.averageDailyVolume10Day || 0) * (currentPrice || 0);
    if (adv && adv < 10e6) risks.push({
      category: "Liquidity", label: "Low Liquidity",
      description: `Avg daily $ volume of ~$${(adv / 1e6).toFixed(1)}M makes large positions hard to exit.`,
      severity: "medium", source: "Yahoo Finance",
    });

    // ---- AI summary (one-liner heuristic) ----
    const positives: string[] = [];
    const negatives: string[] = [];
    if (card2Score >= 7) positives.push("strong fundamentals");
    if (card3Score >= 7) positives.push("solid growth");
    if (card1Score <= 4) negatives.push("rich valuation");
    if (card6Sub[0].s <= 5) negatives.push("elevated beta");
    if (card4Score <= 4) negatives.push("weak technicals");
    if (card5Score >= 7) positives.push("positive analyst sentiment");
    let summary = "";
    if (composite >= 65) summary = `Attractive risk profile: ${positives.slice(0, 2).join(" and ") || "balanced metrics"}.`;
    else if (composite >= 35) summary = `Mixed picture${positives.length ? ` — ${positives[0]}` : ""}${negatives.length ? ` offset by ${negatives.slice(0, 2).join(" and ")}` : ""}.`;
    else summary = `Elevated risk: ${negatives.slice(0, 2).join(" and ") || "weak across multiple dimensions"}.`;

    // ---- Analyst ratings table ----
    const analystRatings = recommends.slice(0, 6).map((r: any) => ({
      date: r.date,
      buy: (r.analystRatingsbuy || 0) + (r.analystRatingsStrongBuy || 0),
      hold: r.analystRatingsHold || 0,
      sell: (r.analystRatingsSell || 0) + (r.analystRatingsStrongSell || 0),
    }));

    return {
      ticker, company, sources,
      lastUpdated: new Date().toISOString(),
      price: { current: currentPrice, high52, low52, change: yahooQuote?.regularMarketChange ?? null, changePct: yahooQuote?.regularMarketChangePercent ?? null },
      priceChart: priceChartData,
      composite,
      summary,
      cards,
      radar,
      risks,
      macro: {
        fedFunds, treas10y, cpi,
        vix: vixQuote?.regularMarketPrice ?? null,
        dxy: dxyQuote?.regularMarketPrice ?? null,
        spyPerf30,
        vixChange30: vix,
      },
      analyst: {
        ratings: analystRatings,
        targetPrice, upside, consensusLabel, totalAnalysts: totalRecs,
        nextEarnings: profile?.nextEarningsDate || null,
        nextEPSEst,
      },
      filings: filings || [],
    };
  });

export type AnalysisResult = Awaited<ReturnType<typeof analyzeStock>>;
