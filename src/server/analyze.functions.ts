import { createServerFn } from "@tanstack/react-start";
import {
  fetchYahooBundle,
  fetchYahooChart,
  yRaw,
  yStr,
  isYahooRateLimited,
  resetYahooRateLimit,
} from "./sources/yahoo.server";
import { fetchFMPBundle } from "./sources/fmp.server";
import { fetchAVBundle, avNum } from "./sources/alpha-vantage.server";
import { fetchSECBundle, checkFilingTimeliness } from "./sources/sec.server";
import { fetchFredBundle, FRED_SERIES } from "./sources/fred.server";
import { fetchWikiSummary } from "./sources/wiki.server";
import { sma, rsi, macdCalc, bollinger, histVolatility } from "./sources/technicals.server";
import { pick, SourceLedger, setYahooDemoted, type Indicator } from "./sources/waterfall.server";

// ────────────────────── small utility helpers ──────────────────────
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

// ────────────────────── main ──────────────────────
export const analyzeStock = createServerFn({ method: "POST" })
  .inputValidator((d: { ticker: string; fmpKey?: string; avKey?: string; forceYahooRetry?: boolean }) => {
    const t = (d?.ticker || "").trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(t)) throw new Error("Invalid ticker");
    return {
      ticker: t,
      fmpKey: typeof d?.fmpKey === "string" ? d.fmpKey.trim() : "",
      avKey: typeof d?.avKey === "string" ? d.avKey.trim() : "",
      forceYahooRetry: !!d?.forceYahooRetry,
    };
  })
  .handler(async ({ data }) => {
    const { ticker, fmpKey, avKey, forceYahooRetry } = data;
    const ledger = new SourceLedger();

    // If user clicked "Retry Yahoo", clear the rate-limit flag before fetching.
    if (forceYahooRetry) resetYahooRateLimit();

    // 1. Fan out ALL sources in parallel.
    const [yahooR, chartR, fmpR, avR, secR, fredR] = await Promise.allSettled([
      fetchYahooBundle(ticker),
      fetchYahooChart(ticker),
      fetchFMPBundle(ticker, fmpKey),
      fetchAVBundle(ticker, avKey),
      fetchSECBundle(ticker),
      fetchFredBundle(),
    ]);

    const yahoo = yahooR.status === "fulfilled" ? yahooR.value : null;
    const chart = chartR.status === "fulfilled" ? chartR.value : null;
    const fmp = fmpR.status === "fulfilled" ? fmpR.value : null;
    const av = avR.status === "fulfilled" ? avR.value : null;
    const sec = secR.status === "fulfilled" ? secR.value : null;
    const fred = fredR.status === "fulfilled" ? fredR.value : null;

    // Yahoo demotion: once 429'd, demote Yahoo across all pick() calls so FMP
    // / AV / SEC become the primary sources for the rest of this request.
    const yahooRateLimited = isYahooRateLimited();
    setYahooDemoted(yahooRateLimited);

    // Set per-source status (drives the footer).
    ledger.setStatus("Yahoo", yahooRateLimited ? "rate-limit" : yahoo?.ok ? "ok" : "failed");
    ledger.setStatus("Yahoo Chart", yahooRateLimited ? "rate-limit" : chart ? "ok" : "failed");
    ledger.setStatus(
      "FMP",
      !fmp?.hasKey ? "no-key" : fmp?.rateLimited ? "rate-limit" : fmp?.ok ? "ok" : "failed",
    );
    ledger.setStatus(
      "Alpha Vantage",
      !av?.hasKey ? "no-key" : av?.rateLimited ? "rate-limit" : av?.ok ? "ok" : "failed",
    );
    ledger.setStatus("SEC EDGAR", sec?.ok ? "ok" : "failed");
    ledger.setStatus("FRED", fred?.ok ? "ok" : "failed");
    ledger.setStatus("Wikipedia", "failed"); // updated below if used

    // Convenience aliases for Yahoo modules
    const Yprice = yahoo?.price || {};
    const Ysd = yahoo?.summaryDetail || {};
    const Yks = yahoo?.defaultKeyStatistics || {};
    const Yfin = yahoo?.financialData || {};
    const Yprof = yahoo?.assetProfile || {};
    const YincH = yahoo?.incomeStatementHistory?.incomeStatementHistory || [];
    const YbalH = yahoo?.balanceSheetHistory?.balanceSheetStatements || [];
    const YcashH = yahoo?.cashflowStatementHistory?.cashflowStatements || [];
    const YearTrend = yahoo?.earningsTrend?.trend || [];
    const YrecTrend = yahoo?.recommendationTrend?.trend || [];
    const Yupgrades = yahoo?.upgradeDowngradeHistory?.history || [];
    const YinstOwn = yahoo?.institutionOwnership?.ownershipList || [];
    const YinsiderTx = yahoo?.insiderTransactions?.transactions || [];
    const Ycal = yahoo?.calendarEvents || {};
    const YsecFilings = yahoo?.secFilings?.filings || [];

    const FMPp = fmp?.profile || null;
    const FMPr = fmp?.ratiosTtm || null;
    const FMPincome = fmp?.income || [];
    const FMPbalance = fmp?.balance || [];
    const FMPcashflow = fmp?.cashflow || [];

    const AVo = av?.overview || null;

    // ────────────── Price + technicals (Yahoo Chart, then computed) ──────────────
    const series = chart?.series || [];
    const closes = series.map((p) => p.close);
    const sma50Arr = sma(closes, 50);
    const sma200Arr = sma(closes, 200);
    const sixMo = Math.max(0, closes.length - 126);
    const priceChart = series.slice(sixMo).map((p, i) => ({
      date: p.date,
      close: p.close,
      sma50: sma50Arr[sixMo + i],
      sma200: sma200Arr[sixMo + i],
    }));

    const lastClose = closes[closes.length - 1] ?? null;
    const currentPrice = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yprice?.regularMarketPrice) },
      { source: "Yahoo Chart", get: () => lastClose },
      { source: "FMP", get: () => FMPp?.price ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.Latest_Quarter ? null : null) },
    ]);
    ledger.record("price", currentPrice);

    const high52 = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.fiftyTwoWeekHigh) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.["52WeekHigh"]) },
      { source: "Yahoo Chart", get: () => (closes.length ? Math.max(...closes) : null) },
    ]);
    const low52 = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.fiftyTwoWeekLow) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.["52WeekLow"]) },
      { source: "Yahoo Chart", get: () => (closes.length ? Math.min(...closes) : null) },
    ]);
    ledger.record("52w high", high52);
    ledger.record("52w low", low52);

    const fiftyDayAvg = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.fiftyDayAverage) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.["50DayMovingAverage"]) },
      { source: "computed", get: () => sma50Arr[sma50Arr.length - 1] ?? null },
    ]);
    const twoHundredDayAvg = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.twoHundredDayAverage) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.["200DayMovingAverage"]) },
      { source: "computed", get: () => sma200Arr[sma200Arr.length - 1] ?? null },
    ]);
    ledger.record("50d MA", fiftyDayAvg);
    ledger.record("200d MA", twoHundredDayAvg);

    const dayHigh = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.regularMarketDayHigh) ?? yRaw(Yprice?.regularMarketDayHigh) },
    ]);
    const dayLow = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.regularMarketDayLow) ?? yRaw(Yprice?.regularMarketDayLow) },
    ]);
    const volume = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.regularMarketVolume) ?? yRaw(Yprice?.regularMarketVolume) },
    ]);
    const avgVol = pick<number>([{ source: "Yahoo", get: () => yRaw(Ysd?.averageVolume) }]);
    const avgVol10 = pick<number>([{ source: "Yahoo", get: () => yRaw(Ysd?.averageVolume10days) }]);
    const changePctInd = pick<number>(
      [{ source: "Yahoo", get: () => yRaw(Yprice?.regularMarketChangePercent) }],
      { acceptZero: true },
    );
    const change = pick<number>(
      [{ source: "Yahoo", get: () => yRaw(Yprice?.regularMarketChange) }],
      { acceptZero: true },
    );

    // RSI / MACD / BB / HV — prefer Yahoo chart computed; fall back to AV's pre-computed
    const rsiVal = pick<number>([
      { source: "computed", get: () => rsi(closes, 14) },
      {
        source: "Alpha Vantage",
        get: () => {
          const ta = av?.rsi?.["Technical Analysis: RSI"];
          if (!ta) return null;
          const dates = Object.keys(ta).sort().reverse();
          return avNum(ta[dates[0]]?.RSI);
        },
      },
    ]);
    const macdLastObj = macdCalc(closes);
    const macdVal = pick<{ macd: number; signal: number; hist: number }>([
      { source: "computed", get: () => macdLastObj },
      {
        source: "Alpha Vantage",
        get: () => {
          const ta = av?.macd?.["Technical Analysis: MACD"];
          if (!ta) return null;
          const dates = Object.keys(ta).sort().reverse();
          const row = ta[dates[0]];
          if (!row) return null;
          const m = avNum(row.MACD);
          const s = avNum(row.MACD_Signal);
          const h = avNum(row.MACD_Hist);
          return m != null && s != null ? { macd: m, signal: s, hist: h ?? m - s } : null;
        },
      },
    ]);
    const bb = pick<{ mid: number; upper: number; lower: number }>([
      { source: "computed", get: () => bollinger(closes, 20, 2) },
      {
        source: "Alpha Vantage",
        get: () => {
          const ta = av?.bbands?.["Technical Analysis: BBANDS"];
          if (!ta) return null;
          const dates = Object.keys(ta).sort().reverse();
          const row = ta[dates[0]];
          if (!row) return null;
          const upper = avNum(row["Real Upper Band"]);
          const mid = avNum(row["Real Middle Band"]);
          const lower = avNum(row["Real Lower Band"]);
          return upper != null && mid != null && lower != null ? { upper, mid, lower } : null;
        },
      },
    ]);
    const histVol = pick<number>([{ source: "computed", get: () => histVolatility(closes) }]);
    const sma50Last = sma50Arr[sma50Arr.length - 1];
    const sma200Last = sma200Arr[sma200Arr.length - 1];
    const cp = currentPrice.value;
    const priceVs50 = sma50Last && cp ? (cp - sma50Last) / sma50Last : null;
    const priceVs200 = sma200Last && cp ? (cp - sma200Last) / sma200Last : null;
    const pos52w = cp && high52.value && low52.value ? (cp - low52.value) / (high52.value - low52.value) : null;
    ledger.record("RSI", rsiVal);
    ledger.record("MACD", macdVal as any);
    ledger.record("Bollinger", bb as any);
    ledger.record("HV30d", histVol);

    // ────────────── Valuation (waterfall) ──────────────
    const trailingPE = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.trailingPE) ?? yRaw(Yks?.trailingPE) },
      { source: "FMP", get: () => FMPr?.peRatioTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.PERatio) },
    ]);
    const forwardPE = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.forwardPE) ?? yRaw(Yks?.forwardPE) },
      { source: "FMP", get: () => FMPr?.priceEarningsRatioTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.ForwardPE) },
    ]);
    const priceToBook = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.priceToBook) },
      { source: "FMP", get: () => FMPr?.pbRatioTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.PriceToBookRatio) },
    ]);
    const ps = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.priceToSalesTrailing12Months) },
      { source: "FMP", get: () => FMPr?.priceToSalesRatioTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.PriceToSalesRatioTTM) },
    ]);
    const evEbitda = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.enterpriseToEbitda) },
      { source: "FMP", get: () => FMPr?.enterpriseValueMultipleTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.EVToEBITDA) },
    ]);
    const peg = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.pegRatio) },
      { source: "FMP", get: () => FMPr?.pegRatioTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.PEGRatio) },
    ]);
    const enterpriseValue = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.enterpriseValue) },
      { source: "FMP", get: () => FMPp?.mktCap && FMPp?.beta ? null : null },
    ]);
    const marketCap = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.marketCap) ?? yRaw(Yprice?.marketCap) },
      { source: "FMP", get: () => FMPp?.mktCap ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.MarketCapitalization) },
    ]);
    [trailingPE, forwardPE, priceToBook, ps, evEbitda, peg, enterpriseValue, marketCap].forEach(
      (i, idx) =>
        ledger.record(["P/E", "Fwd P/E", "P/B", "P/S", "EV/EBITDA", "PEG", "EV", "Market Cap"][idx], i),
    );

    // ────────────── Quality (waterfall) ──────────────
    const grossMargins = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.grossMargins) },
      { source: "FMP", get: () => FMPr?.grossProfitMarginTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.GrossProfitTTM) && avNum(AVo?.RevenueTTM) ? avNum(AVo?.GrossProfitTTM)! / avNum(AVo?.RevenueTTM)! : null },
      { source: "SEC EDGAR", get: () => sec?.facts?.grossProfit && sec?.facts?.revenues ? sec.facts.grossProfit / sec.facts.revenues : null },
    ]);
    const opMargin = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.operatingMargins) },
      { source: "FMP", get: () => FMPr?.operatingProfitMarginTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.OperatingMarginTTM) },
      { source: "SEC EDGAR", get: () => sec?.facts?.operatingIncome && sec?.facts?.revenues ? sec.facts.operatingIncome / sec.facts.revenues : null },
    ]);
    const profitMargins = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.profitMargins) },
      { source: "FMP", get: () => FMPr?.netProfitMarginTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.ProfitMargin) },
      { source: "SEC EDGAR", get: () => sec?.facts?.netIncome && sec?.facts?.revenues ? sec.facts.netIncome / sec.facts.revenues : null },
    ]);
    const roe = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.returnOnEquity) },
      { source: "FMP", get: () => FMPr?.returnOnEquityTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.ReturnOnEquityTTM) },
    ]);
    const roa = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.returnOnAssets) },
      { source: "FMP", get: () => FMPr?.returnOnAssetsTTM ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.ReturnOnAssetsTTM) },
    ]);
    // Yahoo returns D/E as percentage (e.g. 195 = 1.95). Normalise.
    let de = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.debtToEquity) },
      { source: "FMP", get: () => FMPr?.debtEquityRatioTTM ?? null },
      { source: "SEC EDGAR", get: () => sec?.facts?.liabilities && sec?.facts?.equity ? sec.facts.liabilities / sec.facts.equity : null },
    ]);
    if (de.value != null && de.value > 5) de = { value: de.value / 100, source: de.source };

    const currentRatio = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.currentRatio) },
      { source: "FMP", get: () => FMPr?.currentRatioTTM ?? null },
    ]);
    const quickRatio = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.quickRatio) },
      { source: "FMP", get: () => FMPr?.quickRatioTTM ?? null },
    ]);
    const freeCashflow = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.freeCashflow) },
      { source: "FMP", get: () => FMPcashflow[0]?.freeCashFlow ?? null },
      { source: "SEC EDGAR", get: () => null }, // would need explicit OCF & Capex concepts
    ]);
    const totalCash = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.totalCash) },
      { source: "FMP", get: () => FMPbalance[0]?.cashAndCashEquivalents ?? null },
    ]);
    const totalDebt = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.totalDebt) },
      { source: "FMP", get: () => FMPbalance[0]?.totalDebt ?? null },
      { source: "SEC EDGAR", get: () => sec?.facts?.longTermDebt ?? null },
    ]);
    const revenuePerShare = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.revenuePerShare) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.RevenuePerShareTTM) },
    ]);
    const eps = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.trailingEps) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.DilutedEPSTTM) ?? avNum(AVo?.EPS) },
      { source: "SEC EDGAR", get: () => sec?.facts?.eps ?? null },
    ]);
    const fcfYield = freeCashflow.value && marketCap.value ? freeCashflow.value / marketCap.value : null;

    [grossMargins, opMargin, profitMargins, roe, roa, de, currentRatio, quickRatio, freeCashflow, totalCash, totalDebt, revenuePerShare, eps]
      .forEach((i, idx) =>
        ledger.record(["Gross Margin", "Op Margin", "Net Margin", "ROE", "ROA", "D/E", "Current Ratio", "Quick Ratio", "FCF", "Cash", "Total Debt", "Rev/Share", "EPS"][idx], i),
      );

    // ────────────── Growth ──────────────
    // YoY revenue growth: try Yahoo's pre-computed; else compute from the 4
    // most-recent quarterly statements (Y/Y compares q0 to q3); else SEC
    // history (annual, latest two years).
    const manualRevYoYFromYahoo = (() => {
      if (YincH.length < 4) return null;
      const recent = yRaw(YincH[0]?.totalRevenue);
      const yearAgo = yRaw(YincH[3]?.totalRevenue);
      if (recent && yearAgo && yearAgo > 0) return (recent - yearAgo) / yearAgo;
      return null;
    })();
    const fmpRevYoY = (() => {
      if (FMPincome.length < 2) return null;
      const r0 = FMPincome[0]?.revenue;
      const r1 = FMPincome[1]?.revenue;
      return r0 && r1 ? (r0 - r1) / r1 : null;
    })();
    const secRevYoY = (() => {
      const h = sec?.facts?.revenueHistory || [];
      if (h.length < 2 || !h[1].val) return null;
      return (h[0].val - h[1].val) / h[1].val;
    })();
    const revenueGrowth = pick<number>(
      [
        { source: "Yahoo", get: () => yRaw(Yfin?.revenueGrowth) },
        { source: "FMP", get: () => fmpRevYoY },
        { source: "Alpha Vantage", get: () => avNum(AVo?.QuarterlyRevenueGrowthYOY) },
        { source: "SEC EDGAR", get: () => secRevYoY },
        { source: "computed", get: () => manualRevYoYFromYahoo },
      ],
      { acceptZero: true },
    );
    const earningsGrowth = pick<number>(
      [
        { source: "Yahoo", get: () => yRaw(Yfin?.earningsGrowth) },
        { source: "Alpha Vantage", get: () => avNum(AVo?.QuarterlyEarningsGrowthYOY) },
      ],
      { acceptZero: true },
    );
    const earningsQGrowth = pick<number>(
      [{ source: "Yahoo", get: () => yRaw(Yks?.earningsQuarterlyGrowth) }],
      { acceptZero: true },
    );
    const revenueQGrowth = pick<number>(
      [{ source: "Yahoo", get: () => yRaw(Ysd?.revenueQuarterlyGrowth) }],
      { acceptZero: true },
    );
    [revenueGrowth, earningsGrowth].forEach((i, idx) =>
      ledger.record(["Revenue Growth", "Earnings Growth"][idx], i),
    );

    // ────────────── Risk extras ──────────────
    const beta = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.beta) ?? yRaw(Yks?.beta) },
      { source: "FMP", get: () => FMPp?.beta ?? null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.Beta) },
    ]);
    const shortPct = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.shortPercentOfFloat) },
    ]);
    const shortRatio = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.shortRatio) ?? yRaw(Ysd?.shortRatio) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.ShortRatio) },
    ]);
    ledger.record("Beta", beta);
    ledger.record("Short %", shortPct);

    // ────────────── Sentiment / analysts ──────────────
    const lastRec = YrecTrend[0] || {};
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

    const targetPrice = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.targetMeanPrice) },
      {
        source: "FMP",
        get: () => {
          const arr = fmp?.priceTargets || [];
          if (!arr.length) return null;
          const vals = arr.map((p: any) => p.priceTarget).filter((v: any) => typeof v === "number" && isFinite(v));
          if (!vals.length) return null;
          return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
        },
      },
      { source: "Alpha Vantage", get: () => avNum(AVo?.AnalystTargetPrice) },
    ]);
    const upside = targetPrice.value && currentPrice.value ? (targetPrice.value - currentPrice.value) / currentPrice.value : null;
    ledger.record("Target Price", targetPrice);

    const recentUpgrades = (() => {
      // Yahoo first; if empty, FMP.
      if (Yupgrades.length) {
        return Yupgrades.slice(0, 10).map((u: any) => ({
          date: u.epochGradeDate ? new Date(u.epochGradeDate * 1000).toISOString().slice(0, 10) : null,
          firm: u.firm || null,
          action: u.action || null,
          toGrade: u.toGrade || null,
          fromGrade: u.fromGrade || null,
          source: "Yahoo",
        }));
      }
      const arr = fmp?.analystRecs || [];
      return arr.slice(0, 10).map((r: any) => ({
        date: r.date || null,
        firm: r.analystCompany || null,
        action: r.action || null,
        toGrade: r.ratingTo || r.newGrade || null,
        fromGrade: r.ratingFrom || r.previousGrade || null,
        source: "FMP",
      }));
    })();

    // ────────────── Ownership ──────────────
    const heldPctInst = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.heldPercentInstitutions) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.PercentInstitutions) },
    ]);
    const heldPctInsiders = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.heldPercentInsiders) },
      { source: "Alpha Vantage", get: () => avNum(AVo?.PercentInsiders) },
    ]);
    const topHolders =
      YinstOwn.length > 0
        ? YinstOwn.slice(0, 5).map((h: any) => ({
            organization: h.organization || null,
            pctHeld: yRaw(h.pctHeld),
            reportDate: h.reportDate?.fmt || null,
            value: yRaw(h.value),
            source: "Yahoo",
          }))
        : (fmp?.institutionalHolders || []).slice(0, 5).map((h: any) => ({
            organization: h.holder || null,
            pctHeld: null,
            reportDate: h.dateReported || null,
            value: h.shares ? Number(h.shares) : null,
            source: "FMP",
          }));
    const recentInsiderTx =
      YinsiderTx.length > 0
        ? YinsiderTx.slice(0, 5).map((t: any) => ({
            filerName: t.filerName || null,
            filerRelation: t.filerRelation || null,
            transactionText: t.transactionText || null,
            shares: yRaw(t.shares),
            value: yRaw(t.value),
            startDate: t.startDate?.fmt || null,
            source: "Yahoo",
          }))
        : (fmp?.insiderTrading || []).slice(0, 5).map((t: any) => ({
            filerName: t.reportingName || null,
            filerRelation: t.typeOfOwner || null,
            transactionText: t.transactionType || null,
            shares: t.securitiesTransacted ? Number(t.securitiesTransacted) : null,
            value: t.price && t.securitiesTransacted ? Number(t.price) * Number(t.securitiesTransacted) : null,
            startDate: t.transactionDate || null,
            source: "FMP",
          }));

    // ────────────── Earnings calendar ──────────────
    const nextEarnings = Ycal?.earnings?.earningsDate?.[0]?.fmt || null;
    const nextEPSEst = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ycal?.earnings?.earningsAverage) },
      {
        source: "FMP",
        get: () => fmp?.analystEstimates?.[0]?.estimatedEpsAvg ?? null,
      },
    ]);
    const nextRevEst = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ycal?.earnings?.revenueAverage) },
      {
        source: "FMP",
        get: () => fmp?.analystEstimates?.[0]?.estimatedRevenueAvg ?? null,
      },
    ]);

    // ────────────── SEC filings ──────────────
    const filings =
      sec?.submissions?.filings && sec.submissions.filings.length
        ? sec.submissions.filings
        : YsecFilings.slice(0, 5).map((f: any) => ({
            form: f.type,
            filingDate: f.date,
            accession: "",
            primaryDoc: "",
          }));

    // ────────────── SEC filing timeliness ──────────────
    const filingTimeliness = checkFilingTimeliness(sec?.submissions || null);

    // ────────────── Company info (waterfall) ──────────────
    const companyName = pick<string>([
      { source: "Yahoo", get: () => yStr(Yprice?.longName) || yStr(Yprice?.shortName) },
      { source: "FMP", get: () => FMPp?.companyName || null },
      { source: "SEC EDGAR", get: () => sec?.submissions?.name || null },
      { source: "Alpha Vantage", get: () => AVo?.Name || null },
    ]);
    const sector = pick<string>([
      { source: "Yahoo", get: () => Yprof?.sector || null },
      { source: "FMP", get: () => FMPp?.sector || null },
      { source: "Alpha Vantage", get: () => AVo?.Sector || null },
    ]);
    const industry = pick<string>([
      { source: "Yahoo", get: () => Yprof?.industry || null },
      { source: "FMP", get: () => FMPp?.industry || null },
      { source: "Alpha Vantage", get: () => AVo?.Industry || null },
    ]);
    const country = pick<string>([
      { source: "Yahoo", get: () => Yprof?.country || null },
      { source: "FMP", get: () => FMPp?.country || null },
      { source: "Alpha Vantage", get: () => AVo?.Country || null },
    ]);
    const exchange = pick<string>([
      { source: "Yahoo", get: () => yStr(Yprice?.exchangeName) || Yprice?.exchange || null },
      { source: "FMP", get: () => FMPp?.exchangeShortName || null },
      { source: "Alpha Vantage", get: () => AVo?.Exchange || null },
    ]);
    const website = pick<string>([
      { source: "Yahoo", get: () => Yprof?.website || null },
      { source: "FMP", get: () => FMPp?.website || null },
    ]);
    const employees = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yprof?.fullTimeEmployees) },
      { source: "FMP", get: () => FMPp?.fullTimeEmployees ? Number(FMPp.fullTimeEmployees) : null },
      { source: "Alpha Vantage", get: () => avNum(AVo?.FullTimeEmployees) },
    ]);

    // Description: prefer rich source; fall back to Wikipedia using the
    // resolved company name.
    let descSource: "Yahoo" | "FMP" | "Alpha Vantage" | "Wikipedia" | null = null;
    let description: string | null = null;
    if (Yprof?.longBusinessSummary) { description = Yprof.longBusinessSummary; descSource = "Yahoo"; }
    else if (FMPp?.description) { description = FMPp.description; descSource = "FMP"; }
    else if (AVo?.Description) { description = AVo.Description; descSource = "Alpha Vantage"; }
    else {
      // Try Wikipedia using the actual resolved name (not the raw ticker).
      const wikiName = companyName.value || ticker;
      const wiki = await fetchWikiSummary(wikiName);
      if (wiki) {
        description = wiki;
        descSource = "Wikipedia";
        ledger.setStatus("Wikipedia", "ok");
      }
    }

    const company = {
      name: companyName.value || ticker,
      nameSource: companyName.source,
      sector: sector.value,
      sectorSource: sector.source,
      industry: industry.value,
      industrySource: industry.source,
      country: country.value,
      exchange: exchange.value,
      cik: sec?.cik || null,
      website: website.value,
      description,
      descriptionSource: descSource,
      sic: sec?.submissions?.sic || null,
      sicDescription: sec?.submissions?.sicDescription || null,
      stateOfIncorporation: sec?.submissions?.stateOfIncorporation || null,
      fiscalYearEnd: sec?.submissions?.fiscalYearEnd || null,
      employees: employees.value,
    };

    // ────────────── Macro (FRED) ──────────────
    const macroSeries = fred?.series || ({} as Record<string, any>);
    const macro = {
      fedFunds: macroSeries.FEDFUNDS?.current ?? null,
      treas10y: macroSeries.DGS10?.current ?? null,
      treas2y: macroSeries.DGS2?.current ?? null,
      yieldCurve: macroSeries.T10Y2Y?.current ?? null,
      cpi: macroSeries.CPIAUCSL?.current ?? null,
      unemployment: macroSeries.UNRATE?.current ?? null,
      dxy: macroSeries.DTWEXBGS?.current ?? null,
      vix: macroSeries.VIXCLS?.current ?? null,
      sp500: macroSeries.SP500?.current ?? null,
      // 3-month-ago snapshot for trend arrows
      previous: Object.fromEntries(
        FRED_SERIES.map((s) => [s, macroSeries[s]?.previous ?? null]),
      ) as Record<string, number | null>,
    };

    // ────────────── Card sub-scores (use waterfall values) ──────────────
    const card1Sub = [
      { k: "P/E TTM", v: trailingPE.value, s: score(trailingPE.value, [{ lt: 15, s: 10 }, { lt: 25, s: 7 }, { lt: 35, s: 4 }, { lt: Infinity, s: 1 }]), source: trailingPE.source },
      { k: "Forward P/E", v: forwardPE.value, s: score(forwardPE.value, [{ lt: 12, s: 10 }, { lt: 20, s: 7 }, { lt: 30, s: 4 }, { lt: Infinity, s: 1 }]), source: forwardPE.source },
      { k: "EV/EBITDA", v: evEbitda.value, s: score(evEbitda.value, [{ lt: 8, s: 10 }, { lt: 15, s: 7 }, { lt: 25, s: 4 }, { lt: Infinity, s: 1 }]), source: evEbitda.source },
      { k: "PEG", v: peg.value, s: peg.value != null && peg.value > 0 ? score(peg.value, [{ lt: 1, s: 10 }, { lt: 1.5, s: 7 }, { lt: 2, s: 4 }, { lt: Infinity, s: 1 }]) : 5, source: peg.source },
    ];
    const card1Score = card1Sub.reduce((a, b) => a + b.s, 0) / card1Sub.length;

    const card2Sub = [
      { k: "Gross Margin", v: grossMargins.value, s: sBand(grossMargins.value, 0.15, 0.3, 0.5), source: grossMargins.source },
      { k: "ROE", v: roe.value, s: sBand(roe.value, 0, 0.1, 0.2), source: roe.source },
      { k: "Debt/Equity", v: de.value, s: score(de.value, [{ lt: 0.3, s: 10 }, { lt: 1, s: 7 }, { lt: 2, s: 4 }, { lt: Infinity, s: 1 }]), source: de.source },
      { k: "FCF Yield", v: fcfYield, s: sBand(fcfYield, 0, 0.02, 0.05), source: freeCashflow.source },
    ];
    const card2Score = card2Sub.reduce((a, b) => a + b.s, 0) / card2Sub.length;

    const card3Sub = [
      { k: "Revenue Growth YoY", v: revenueGrowth.value, s: sBand(revenueGrowth.value, 0, 0.1, 0.2), source: revenueGrowth.source },
      { k: "Earnings Growth YoY", v: earningsGrowth.value, s: sBand(earningsGrowth.value, 0, 0.05, 0.15), source: earningsGrowth.source },
    ];
    const card3Score = card3Sub.reduce((a, b) => a + b.s, 0) / card3Sub.length;

    const card4Sub = [
      { k: "RSI (14d)", v: rsiVal.value, s: rsiVal.value == null ? 5 : rsiVal.value >= 40 && rsiVal.value <= 60 ? 10 : (rsiVal.value >= 30 && rsiVal.value < 40) || (rsiVal.value > 60 && rsiVal.value <= 70) ? 6 : 3, source: rsiVal.source },
      { k: "Price vs 200d MA", v: priceVs200, s: priceVs200 == null ? 5 : priceVs200 > 0.1 ? 4 : priceVs200 > 0 ? 10 : priceVs200 > -0.1 ? 7 : 3, source: twoHundredDayAvg.source },
    ];
    const card4Score = card4Sub.reduce((a, b) => a + b.s, 0) / card4Sub.length;

    const card5Sub = [
      { k: "Analyst Consensus", v: consensusScore, s: consensusScore == null ? 5 : consensusScore <= 1.5 ? 10 : consensusScore <= 2.5 ? 7 : consensusScore <= 3.5 ? 4 : 1, source: YrecTrend.length ? "Yahoo" : null },
      { k: "Short Interest", v: shortPct.value, s: shortPct.value == null ? 5 : shortPct.value < 0.03 ? 10 : shortPct.value < 0.07 ? 7 : shortPct.value < 0.15 ? 4 : 1, source: shortPct.source },
      { k: "Upside to Target", v: upside, s: upside == null ? 5 : upside > 0.3 ? 10 : upside > 0.15 ? 7 : upside > 0 ? 4 : 1, source: targetPrice.source },
    ];
    const card5Score = card5Sub.reduce((a, b) => a + b.s, 0) / card5Sub.length;

    const card6Sub = [
      { k: "Beta (1y)", v: beta.value, s: beta.value == null ? 5 : beta.value < 0.8 ? 10 : beta.value < 1.2 ? 8 : beta.value < 1.8 ? 5 : 2, source: beta.source },
      { k: "Hist Volatility 30d", v: histVol.value, s: histVol.value == null ? 5 : histVol.value < 0.2 ? 10 : histVol.value < 0.35 ? 7 : histVol.value < 0.6 ? 4 : 1, source: histVol.source },
    ];
    const card6Score = card6Sub.reduce((a, b) => a + b.s, 0) / card6Sub.length;

    const cards = [
      { id: "valuation", title: "Valuation", weight: 22, score: card1Score, indicators: card1Sub, source: "Waterfall", extras: { marketCap: marketCap.value, ps: ps.value, priceToBook: priceToBook.value, enterpriseValue: enterpriseValue.value } },
      { id: "quality", title: "Financial Quality", weight: 22, score: card2Score, indicators: card2Sub, source: "Waterfall", extras: { opMargin: opMargin.value, profitMargins: profitMargins.value, roa: roa.value, currentRatio: currentRatio.value, quickRatio: quickRatio.value, freeCashflow: freeCashflow.value, totalCash: totalCash.value, totalDebt: totalDebt.value, revenuePerShare: revenuePerShare.value, eps: eps.value } },
      { id: "growth", title: "Growth", weight: 18, score: card3Score, indicators: card3Sub, source: "Waterfall", extras: { earningsQGrowth: earningsQGrowth.value, revenueQGrowth: revenueQGrowth.value, nextEPSEst: nextEPSEst.value, nextRevEst: nextRevEst.value } },
      { id: "technical", title: "Momentum / Technical", weight: 10, score: card4Score, indicators: card4Sub, source: "computed", extras: { macd: macdVal.value, priceVs50, pos52w, fiftyDayAvg: fiftyDayAvg.value, twoHundredDayAvg: twoHundredDayAvg.value, bollinger: bb.value, histVol: histVol.value } },
      { id: "sentiment", title: "Sentiment", weight: 10, score: card5Score, indicators: card5Sub, source: "Waterfall", extras: { totalAnalysts, consensusLabel, targetPrice: targetPrice.value, shortRatio: shortRatio.value, heldPctInst: heldPctInst.value, heldPctInsiders: heldPctInsiders.value } },
      { id: "macro", title: "Risk Metrics", weight: 10, score: card6Score, indicators: card6Sub, source: "Waterfall", extras: { histVol: histVol.value, avgVol: avgVol.value, avgVol10: avgVol10.value } },
    ];

    const composite = Math.round(
      (cards.reduce((s, c) => s + c.score * c.weight, 0) / cards.reduce((s, c) => s + c.weight, 0)) * 10,
    );

    // ────────────── Risk Radar ──────────────
    const sensitiveSectors = ["Technology", "Healthcare", "Energy", "Financial Services"];
    const marketRisk = beta.value != null ? Math.min(10, Math.max(0, (beta.value - 0.5) * 5)) : 5;
    const finRisk = de.value != null ? Math.min(10, Math.max(0, de.value * 3)) : 5;
    const valRisk = trailingPE.value != null ? Math.min(10, Math.max(0, (trailingPE.value - 10) / 4)) : 5;
    const regRisk = company.sector && sensitiveSectors.includes(company.sector) ? 7 : 4;
    const liquidityRisk = (() => {
      const adv = (avgVol10.value || 0) * (currentPrice.value || 0);
      if (!adv) return 5;
      if (adv < 10e6) return 9;
      if (adv < 100e6) return 6;
      if (adv < 1e9) return 3;
      return 1;
    })();
    const sentimentRisk = shortPct.value != null ? Math.min(10, shortPct.value * 50) : 5;
    const radar = [
      { axis: "Market", value: +marketRisk.toFixed(1) },
      { axis: "Financial", value: +finRisk.toFixed(1) },
      { axis: "Valuation", value: +valRisk.toFixed(1) },
      { axis: "Regulatory", value: +regRisk.toFixed(1) },
      { axis: "Liquidity", value: +liquidityRisk.toFixed(1) },
      { axis: "Sentiment", value: +sentimentRisk.toFixed(1) },
    ];

    // ────────────── Heuristic risks (until AI runs) ──────────────
    const risks: { category: string; label: string; description: string; severity: "high" | "medium" | "low"; source: string }[] = [];
    if (beta.value != null && beta.value > 1.3) risks.push({ category: "Market", label: "High Beta", description: `Beta of ${beta.value.toFixed(2)} — moves ${((beta.value - 1) * 100).toFixed(0)}% more than the market.`, severity: beta.value > 1.8 ? "high" : "medium", source: beta.source || "Yahoo" });
    if (trailingPE.value != null && trailingPE.value > 30 && macro.treas10y != null && macro.treas10y > 4) risks.push({ category: "Market", label: "Rate Sensitivity", description: `High P/E (${trailingPE.value.toFixed(1)}) is vulnerable to elevated rates (10Y at ${macro.treas10y.toFixed(2)}%).`, severity: "medium", source: "FRED + " + (trailingPE.source || "Yahoo") });
    if (macro.yieldCurve != null && macro.yieldCurve < 0) risks.push({ category: "Market", label: "Yield Curve Inverted", description: `10Y minus 2Y is ${macro.yieldCurve.toFixed(2)}% — historically precedes recessions within 12-24 months.`, severity: "medium", source: "FRED" });
    if (trailingPE.value != null && trailingPE.value > 35) risks.push({ category: "Valuation", label: "Premium Valuation", description: `P/E of ${trailingPE.value.toFixed(1)} is well above market average; multiple compression risk.`, severity: "high", source: trailingPE.source || "Yahoo" });
    if (de.value != null && de.value > 2) risks.push({ category: "Financial", label: "Debt Stress", description: `Debt/Equity of ${de.value.toFixed(2)} is elevated; leverage risk.`, severity: "high", source: de.source || "Yahoo" });
    if (fcfYield != null && fcfYield < 0) risks.push({ category: "Financial", label: "Negative FCF", description: "Free cash flow is negative; the company is burning cash.", severity: "high", source: freeCashflow.source || "Yahoo" });
    if (company.sector && sensitiveSectors.includes(company.sector)) risks.push({ category: "Regulatory", label: "Regulatory Exposure", description: `${company.sector} sector faces ongoing regulatory and antitrust scrutiny.`, severity: "medium", source: "Sector classification" });
    if (shortPct.value != null && shortPct.value > 0.1) risks.push({ category: "Sentiment", label: "Elevated Short Interest", description: `${(shortPct.value * 100).toFixed(1)}% of float sold short; bearish positioning.`, severity: shortPct.value > 0.2 ? "high" : "medium", source: shortPct.source || "Yahoo" });
    const adv = (avgVol10.value || 0) * (currentPrice.value || 0);
    if (adv && adv < 10e6) risks.push({ category: "Liquidity", label: "Low Liquidity", description: `Avg daily $ volume of ~$${(adv / 1e6).toFixed(1)}M makes large positions hard to exit.`, severity: "medium", source: "Yahoo" });

    // SEC reporting timeliness — only surface as a risk card when not "ok".
    if (sec?.ok && filingTimeliness.status !== "ok") {
      risks.push({
        category: "Regulatory",
        label: filingTimeliness.status === "missing" ? "SEC Reporting — Missing Filing" : "SEC Reporting — Late Filing",
        description: filingTimeliness.detail,
        severity: filingTimeliness.status === "missing" ? "high" : "medium",
        source: "SEC EDGAR",
      });
    }

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

    // ────────────── Completeness score ──────────────
    const trackedIndicators = [
      currentPrice, high52, low52, fiftyDayAvg, twoHundredDayAvg,
      trailingPE, forwardPE, priceToBook, ps, evEbitda, peg, marketCap,
      grossMargins, opMargin, profitMargins, roe, roa, de, currentRatio, quickRatio, freeCashflow, totalCash, totalDebt, eps,
      revenueGrowth, earningsGrowth,
      beta, shortPct, targetPrice, heldPctInst, heldPctInsiders,
      rsiVal, macdVal as Indicator<unknown>, bb as Indicator<unknown>, histVol,
    ];
    const filled = trackedIndicators.filter((i) => i.value != null).length;
    const completeness = Math.round((filled / trackedIndicators.length) * 100);

    return {
      ticker, company,
      sources: ledger.toJSON(),
      sourceStatus: {
        yahoo: yahoo?.ok || false,
        yahooChart: !!chart,
        yahooRateLimited: isYahooRateLimited(),
        fmp: fmp?.ok || false,
        fmpHasKey: fmp?.hasKey || false,
        fmpRateLimited: fmp?.rateLimited || false,
        av: av?.ok || false,
        avHasKey: av?.hasKey || false,
        avRateLimited: av?.rateLimited || false,
        sec: sec?.ok || false,
        secCik: sec?.cik || null,
        fred: fred?.ok || false,
        wiki: descSource === "Wikipedia",
      },
      completeness: {
        score: completeness,
        filled,
        total: trackedIndicators.length,
      },
      lastUpdated: new Date().toISOString(),
      price: {
        current: currentPrice.value,
        currentSource: currentPrice.source,
        high52: high52.value, low52: low52.value,
        dayHigh: dayHigh.value, dayLow: dayLow.value,
        volume: volume.value, avgVol: avgVol.value, avgVol10: avgVol10.value,
        fiftyDayAvg: fiftyDayAvg.value, twoHundredDayAvg: twoHundredDayAvg.value,
        change: change.value, changePct: changePctInd.value,
      },
      priceChart,
      composite,
      summary,
      cards,
      radar,
      risks,
      filingTimeliness,
      macro,
      analyst: {
        ratings: YrecTrend.slice(0, 6).map((rt: any) => ({
          date: rt.period || "",
          buy: (rt.buy ?? 0) + (rt.strongBuy ?? 0),
          hold: rt.hold ?? 0,
          sell: (rt.sell ?? 0) + (rt.strongSell ?? 0),
        })),
        targetPrice: targetPrice.value,
        targetPriceSource: targetPrice.source,
        upside,
        consensusLabel,
        totalAnalysts,
        nextEarnings,
        nextEPSEst: nextEPSEst.value,
        nextRevEst: nextRevEst.value,
        upgrades: recentUpgrades,
      },
      ownership: {
        topHolders,
        heldPctInst: heldPctInst.value,
        heldPctInsiders: heldPctInsiders.value,
        recentInsiderTx,
      },
      filings,
      news: fmp?.news || [],
    };
  });

export type AnalysisResult = Awaited<ReturnType<typeof analyzeStock>>;
