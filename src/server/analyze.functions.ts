import { createServerFn } from "@tanstack/react-start";
import {
  fetchYahooBundle,
  fetchYahooChart,
  yRaw,
  yStr,
  isYahooRateLimited,
  resetYahooRateLimit,
} from "./sources/yahoo.server";
import {
  fetchPolygonBundle,
  polyFinValue,
  polyYoYGrowth,
  polyBeta,
  polyNewsConsensus,
} from "./sources/polygon.server";
import { fetchTiingoBundle, tgDaily, tgOverview, tgBeatRate } from "./sources/tiingo.server";
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
  .inputValidator((d: { ticker: string; forceYahooRetry?: boolean }) => {
    const t = (d?.ticker || "").trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(t)) throw new Error("Invalid ticker");
    return {
      ticker: t,
      forceYahooRetry: !!d?.forceYahooRetry,
    };
  })
  .handler(async ({ data }) => {
    const { ticker, forceYahooRetry } = data;
    const ledger = new SourceLedger();

    // If user clicked "Retry Yahoo", clear the rate-limit flag before fetching.
    if (forceYahooRetry) resetYahooRateLimit();

    // 1. Fan out ALL sources in parallel.
    const [yahooR, chartR, polyR, tgR, secR, fredR] = await Promise.allSettled([
      fetchYahooBundle(ticker),
      fetchYahooChart(ticker),
      fetchPolygonBundle(ticker),
      fetchTiingoBundle(ticker),
      fetchSECBundle(ticker),
      fetchFredBundle(),
    ]);

    const yahoo = yahooR.status === "fulfilled" ? yahooR.value : null;
    const chart = chartR.status === "fulfilled" ? chartR.value : null;
    const poly = polyR.status === "fulfilled" ? polyR.value : null;
    const tg = tgR.status === "fulfilled" ? tgR.value : null;
    const sec = secR.status === "fulfilled" ? secR.value : null;
    const fred = fredR.status === "fulfilled" ? fredR.value : null;

    // Yahoo demotion: once 429'd, demote Yahoo across all pick() calls.
    const yahooRateLimited = isYahooRateLimited();
    setYahooDemoted(yahooRateLimited);

    // Set per-source status (drives the footer).
    ledger.setStatus("Yahoo", yahooRateLimited ? "rate-limit" : yahoo?.ok ? "ok" : "failed");
    ledger.setStatus("Yahoo Chart", yahooRateLimited ? "rate-limit" : chart ? "ok" : "failed");
    ledger.setStatus(
      "Polygon",
      !poly?.hasKey ? "no-key" : poly?.rateLimited ? "rate-limit" : poly?.ok ? "ok" : "failed",
    );
    ledger.setStatus(
      "Tiingo",
      !tg?.hasKey ? "no-key" : tg?.rateLimited ? "rate-limit" : tg?.ok ? "ok" : "failed",
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
    const YearTrend = yahoo?.earningsTrend?.trend || [];
    const YrecTrend = yahoo?.recommendationTrend?.trend || [];
    const Yupgrades = yahoo?.upgradeDowngradeHistory?.history || [];
    const YinstOwn = yahoo?.institutionOwnership?.ownershipList || [];
    const YinsiderTx = yahoo?.insiderTransactions?.transactions || [];
    const Ycal = yahoo?.calendarEvents || {};
    const YsecFilings = yahoo?.secFilings?.filings || [];

    // Polygon convenience aliases
    const PolyTicker = poly?.ticker || null;
    const PolySnap = poly?.snapshot || null;
    const PolyAggs = poly?.aggs || [];
    const PolyFinAnnual = poly?.financials?.[0]?.financials || null;
    const PolyFinQ = poly?.financialsQuarterly || [];
    const PolyIncomeAnnual = PolyFinAnnual?.income_statement || null;
    const PolyBalanceAnnual = PolyFinAnnual?.balance_sheet || null;
    const PolyCashAnnual = PolyFinAnnual?.cash_flow_statement || null;

    // ────────────── Price + technicals (Yahoo Chart → Polygon → Tiingo) ──────────────
    // Build a unified close-price series, preferring Yahoo, then Polygon, then Tiingo EOD.
    const series =
      chart?.series?.length ? chart.series :
      PolyAggs.length ? PolyAggs.map((a) => ({ date: a.date, close: a.close, high: a.high, low: a.low, volume: a.volume })) :
      tg?.eod?.length ? tg.eod.map((a) => ({ date: a.date, close: a.adjClose, high: a.high, low: a.low, volume: a.volume })) :
      [];
    const closes = series.map((p) => p.close).filter((c) => typeof c === "number" && isFinite(c));
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
      { source: "Polygon", get: () => PolySnap?.day?.c ?? PolySnap?.lastTrade?.p ?? poly?.trades?.price ?? null },
      { source: "Yahoo Chart", get: () => lastClose },
      { source: "Tiingo", get: () => tg?.eod?.[tg.eod.length - 1]?.adjClose ?? null },
    ]);
    ledger.record("price", currentPrice);

    const high52 = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.fiftyTwoWeekHigh) },
      { source: "Polygon", get: () => (PolyAggs.length ? Math.max(...PolyAggs.map((a) => a.high)) : null) },
      { source: "Yahoo Chart", get: () => (closes.length ? Math.max(...closes) : null) },
    ]);
    const low52 = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.fiftyTwoWeekLow) },
      { source: "Polygon", get: () => (PolyAggs.length ? Math.min(...PolyAggs.map((a) => a.low)) : null) },
      { source: "Yahoo Chart", get: () => (closes.length ? Math.min(...closes) : null) },
    ]);
    ledger.record("52w high", high52);
    ledger.record("52w low", low52);

    const fiftyDayAvg = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.fiftyDayAverage) },
      { source: "Polygon", get: () => poly?.sma50 ?? null },
      { source: "computed", get: () => sma50Arr[sma50Arr.length - 1] ?? null },
    ]);
    const twoHundredDayAvg = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.twoHundredDayAverage) },
      { source: "Polygon", get: () => poly?.sma200 ?? null },
      { source: "computed", get: () => sma200Arr[sma200Arr.length - 1] ?? null },
    ]);
    ledger.record("50d MA", fiftyDayAvg);
    ledger.record("200d MA", twoHundredDayAvg);

    const dayHigh = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.regularMarketDayHigh) ?? yRaw(Yprice?.regularMarketDayHigh) },
      { source: "Polygon", get: () => PolySnap?.day?.h ?? null },
    ]);
    const dayLow = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.regularMarketDayLow) ?? yRaw(Yprice?.regularMarketDayLow) },
      { source: "Polygon", get: () => PolySnap?.day?.l ?? null },
    ]);
    const volume = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.regularMarketVolume) ?? yRaw(Yprice?.regularMarketVolume) },
      { source: "Polygon", get: () => PolySnap?.day?.v ?? null },
    ]);
    const avgVol = pick<number>([{ source: "Yahoo", get: () => yRaw(Ysd?.averageVolume) }]);
    const avgVol10 = pick<number>([{ source: "Yahoo", get: () => yRaw(Ysd?.averageVolume10days) }]);
    const changePctInd = pick<number>(
      [
        { source: "Yahoo", get: () => yRaw(Yprice?.regularMarketChangePercent) },
        { source: "Polygon", get: () => (PolySnap?.todaysChangePerc != null ? PolySnap.todaysChangePerc / 100 : null) },
      ],
      { acceptZero: true },
    );
    const change = pick<number>(
      [
        { source: "Yahoo", get: () => yRaw(Yprice?.regularMarketChange) },
        { source: "Polygon", get: () => PolySnap?.todaysChange ?? null },
      ],
      { acceptZero: true },
    );

    // RSI / MACD / BB / HV — prefer Polygon's pre-computed; fall back to local computation.
    const rsiVal = pick<number>([
      { source: "Polygon", get: () => poly?.rsi14 ?? null },
      { source: "computed", get: () => rsi(closes, 14) },
    ]);
    const macdLastObj = macdCalc(closes);
    const macdVal = pick<{ macd: number; signal: number; hist: number }>([
      {
        source: "Polygon",
        get: () =>
          poly?.macd
            ? { macd: poly.macd.value, signal: poly.macd.signal, hist: poly.macd.histogram }
            : null,
      },
      { source: "computed", get: () => macdLastObj },
    ]);
    const bb = pick<{ mid: number; upper: number; lower: number }>([
      { source: "computed", get: () => bollinger(closes, 20, 2) },
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
      { source: "Tiingo", get: () => tgDaily(tg, "peRatio") },
      { source: "Polygon", get: () => {
        const ni = polyFinValue(PolyIncomeAnnual, "net_income_loss");
        const mc = PolyTicker?.market_cap ?? null;
        return ni && mc ? mc / ni : null;
      } },
    ]);
    const forwardPE = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.forwardPE) ?? yRaw(Yks?.forwardPE) },
      { source: "Tiingo", get: () => tgDaily(tg, "forwardPE") ?? tgOverview(tg, "forwardPE") },
    ]);
    const priceToBook = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.priceToBook) },
      { source: "Tiingo", get: () => tgDaily(tg, "pbRatio") },
    ]);
    const ps = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.priceToSalesTrailing12Months) },
      { source: "Tiingo", get: () => tgDaily(tg, "psRatio") },
    ]);
    const evEbitda = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.enterpriseToEbitda) },
      { source: "Tiingo", get: () => tgOverview(tg, "evEbitda") },
    ]);
    const peg = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.pegRatio) },
      { source: "Tiingo", get: () => tgDaily(tg, "trailingPEG1Y") ?? tgOverview(tg, "pegRatio") },
    ]);
    const enterpriseValue = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.enterpriseValue) },
      { source: "Tiingo", get: () => tgDaily(tg, "enterpriseVal") },
    ]);
    const marketCap = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ysd?.marketCap) ?? yRaw(Yprice?.marketCap) },
      { source: "Polygon", get: () => PolyTicker?.market_cap ?? null },
      { source: "Tiingo", get: () => tgDaily(tg, "marketCap") },
    ]);
    [trailingPE, forwardPE, priceToBook, ps, evEbitda, peg, enterpriseValue, marketCap].forEach(
      (i, idx) =>
        ledger.record(["P/E", "Fwd P/E", "P/B", "P/S", "EV/EBITDA", "PEG", "EV", "Market Cap"][idx], i),
    );

    // ────────────── Quality (waterfall) ──────────────
    const polyGrossMargin = (() => {
      const rev = polyFinValue(PolyIncomeAnnual, "revenues");
      const gp = polyFinValue(PolyIncomeAnnual, "gross_profit");
      return rev && gp ? gp / rev : null;
    })();
    const polyOpMargin = (() => {
      const rev = polyFinValue(PolyIncomeAnnual, "revenues");
      const op = polyFinValue(PolyIncomeAnnual, "operating_income_loss");
      return rev && op ? op / rev : null;
    })();
    const polyNetMargin = (() => {
      const rev = polyFinValue(PolyIncomeAnnual, "revenues");
      const ni = polyFinValue(PolyIncomeAnnual, "net_income_loss");
      return rev && ni ? ni / rev : null;
    })();
    const polyDE = (() => {
      const liab = polyFinValue(PolyBalanceAnnual, "liabilities");
      const eq = polyFinValue(PolyBalanceAnnual, "equity");
      return liab && eq ? liab / eq : null;
    })();
    const polyCurrentRatio = (() => {
      const ca = polyFinValue(PolyBalanceAnnual, "current_assets");
      const cl = polyFinValue(PolyBalanceAnnual, "current_liabilities");
      return ca && cl ? ca / cl : null;
    })();

    const grossMargins = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.grossMargins) },
      { source: "Tiingo", get: () => tgOverview(tg, "grossMargin") },
      { source: "Polygon", get: () => polyGrossMargin },
      { source: "SEC EDGAR", get: () => sec?.facts?.grossProfit && sec?.facts?.revenues ? sec.facts.grossProfit / sec.facts.revenues : null },
    ]);
    const opMargin = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.operatingMargins) },
      { source: "Tiingo", get: () => tgOverview(tg, "operatingMargin") },
      { source: "Polygon", get: () => polyOpMargin },
      { source: "SEC EDGAR", get: () => sec?.facts?.operatingIncome && sec?.facts?.revenues ? sec.facts.operatingIncome / sec.facts.revenues : null },
    ]);
    const profitMargins = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.profitMargins) },
      { source: "Tiingo", get: () => tgOverview(tg, "netMargin") },
      { source: "Polygon", get: () => polyNetMargin },
      { source: "SEC EDGAR", get: () => sec?.facts?.netIncome && sec?.facts?.revenues ? sec.facts.netIncome / sec.facts.revenues : null },
    ]);
    const roe = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.returnOnEquity) },
      { source: "Tiingo", get: () => tgOverview(tg, "roe") },
    ]);
    const roa = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.returnOnAssets) },
      { source: "Tiingo", get: () => tgOverview(tg, "roa") },
    ]);
    // Yahoo returns D/E as percentage (e.g. 195 = 1.95). Normalise.
    let de = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.debtToEquity) },
      { source: "Tiingo", get: () => tgOverview(tg, "debtToEquity") },
      { source: "Polygon", get: () => polyDE },
      { source: "SEC EDGAR", get: () => sec?.facts?.liabilities && sec?.facts?.equity ? sec.facts.liabilities / sec.facts.equity : null },
    ]);
    if (de.value != null && de.value > 5) de = { value: de.value / 100, source: de.source };

    const currentRatio = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.currentRatio) },
      { source: "Tiingo", get: () => tgOverview(tg, "currentRatio") },
      { source: "Polygon", get: () => polyCurrentRatio },
    ]);
    const quickRatio = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.quickRatio) },
      { source: "Tiingo", get: () => tgOverview(tg, "quickRatio") },
    ]);
    const freeCashflow = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.freeCashflow) },
      { source: "Polygon", get: () => {
        const ocf = polyFinValue(PolyCashAnnual, "net_cash_flow_from_operating_activities");
        const capex = polyFinValue(PolyCashAnnual, "capital_expenditure");
        if (ocf == null) return null;
        return capex == null ? ocf : ocf + capex; // capex usually negative
      } },
    ]);
    const totalCash = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.totalCash) },
    ]);
    const totalDebt = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.totalDebt) },
      { source: "Polygon", get: () => polyFinValue(PolyBalanceAnnual, "long_term_debt") },
      { source: "SEC EDGAR", get: () => sec?.facts?.longTermDebt ?? null },
    ]);
    const revenuePerShare = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.revenuePerShare) },
    ]);
    const eps = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.trailingEps) },
      { source: "Polygon", get: () => polyFinValue(PolyIncomeAnnual, "basic_earnings_per_share") },
      { source: "SEC EDGAR", get: () => sec?.facts?.eps ?? null },
    ]);
    const fcfYield = freeCashflow.value && marketCap.value ? freeCashflow.value / marketCap.value : null;

    [grossMargins, opMargin, profitMargins, roe, roa, de, currentRatio, quickRatio, freeCashflow, totalCash, totalDebt, revenuePerShare, eps]
      .forEach((i, idx) =>
        ledger.record(["Gross Margin", "Op Margin", "Net Margin", "ROE", "ROA", "D/E", "Current Ratio", "Quick Ratio", "FCF", "Cash", "Total Debt", "Rev/Share", "EPS"][idx], i),
      );

    // ────────────── Growth ──────────────
    const polyRevYoY = polyYoYGrowth(PolyFinQ, "revenues");
    const polyEpsYoY = polyYoYGrowth(PolyFinQ, "basic_earnings_per_share");
    const manualRevYoYFromYahoo = (() => {
      if (YincH.length < 4) return null;
      const recent = yRaw(YincH[0]?.totalRevenue);
      const yearAgo = yRaw(YincH[3]?.totalRevenue);
      if (recent && yearAgo && yearAgo > 0) return (recent - yearAgo) / yearAgo;
      return null;
    })();
    const secRevYoY = (() => {
      const h = sec?.facts?.revenueHistory || [];
      if (h.length < 2 || !h[1].val) return null;
      return (h[0].val - h[1].val) / h[1].val;
    })();
    const revenueGrowth = pick<number>(
      [
        { source: "Yahoo", get: () => yRaw(Yfin?.revenueGrowth) },
        { source: "Polygon", get: () => polyRevYoY },
        { source: "SEC EDGAR", get: () => secRevYoY },
        { source: "computed", get: () => manualRevYoYFromYahoo },
      ],
      { acceptZero: true },
    );
    const earningsGrowth = pick<number>(
      [
        { source: "Yahoo", get: () => yRaw(Yfin?.earningsGrowth) },
        { source: "Polygon", get: () => polyEpsYoY },
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
      { source: "Polygon", get: () => polyBeta(PolyAggs, poly?.spyAggs) },
    ]);
    const shortPct = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.shortPercentOfFloat) },
    ]);
    const shortRatio = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.shortRatio) ?? yRaw(Ysd?.shortRatio) },
    ]);
    ledger.record("Beta", beta);
    ledger.record("Short %", shortPct);

    // ────────────── Sentiment / analysts ──────────────
    const lastRec = YrecTrend[0] || {};
    const buyY = (lastRec.buy ?? 0) + (lastRec.strongBuy ?? 0);
    const holdY = lastRec.hold ?? 0;
    const sellY = (lastRec.sell ?? 0) + (lastRec.strongSell ?? 0);
    const totalAnalystsY = buyY + holdY + sellY;
    const consensusScoreY =
      totalAnalystsY > 0
        ? ((lastRec.strongBuy ?? 0) * 1 +
            (lastRec.buy ?? 0) * 2 +
            (lastRec.hold ?? 0) * 3 +
            (lastRec.sell ?? 0) * 4 +
            (lastRec.strongSell ?? 0) * 5) /
          totalAnalystsY
        : null;

    // Polygon news-sentiment fallback
    const polyConsensus = polyNewsConsensus(poly?.news, ticker);
    const consensusScore = consensusScoreY ?? polyConsensus.score;
    const totalAnalysts = totalAnalystsY > 0 ? totalAnalystsY : polyConsensus.total;
    const consensusLabel =
      consensusScoreY != null
        ? (consensusScoreY <= 1.5 ? "Strong Buy" :
           consensusScoreY <= 2.5 ? "Buy" :
           consensusScoreY <= 3.5 ? "Hold" :
           consensusScoreY <= 4.5 ? "Sell" : "Strong Sell")
        : polyConsensus.label;
    const consensusSource: "Yahoo" | "Polygon" | null =
      totalAnalystsY > 0 ? "Yahoo" : polyConsensus.score != null ? "Polygon" : null;

    const targetPrice = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yfin?.targetMeanPrice) },
      // No reliable free price-target source — leave Polygon/Tiingo unset; SEC has none.
    ]);
    const upside = targetPrice.value && currentPrice.value ? (targetPrice.value - currentPrice.value) / currentPrice.value : null;
    ledger.record("Target Price", targetPrice);

    const recentUpgrades = (() => {
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
      return [];
    })();

    // ────────────── Ownership ──────────────
    const heldPctInst = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.heldPercentInstitutions) },
    ]);
    const heldPctInsiders = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yks?.heldPercentInsiders) },
    ]);
    const topHolders = YinstOwn.length > 0
      ? YinstOwn.slice(0, 5).map((h: any) => ({
          organization: h.organization || null,
          pctHeld: yRaw(h.pctHeld),
          reportDate: h.reportDate?.fmt || null,
          value: yRaw(h.value),
          source: "Yahoo",
        }))
      : [];
    const recentInsiderTx = YinsiderTx.length > 0
      ? YinsiderTx.slice(0, 5).map((t: any) => ({
          filerName: t.filerName || null,
          filerRelation: t.filerRelation || null,
          transactionText: t.transactionText || null,
          shares: yRaw(t.shares),
          value: yRaw(t.value),
          startDate: t.startDate?.fmt || null,
          source: "Yahoo",
        }))
      : [];

    // ────────────── Earnings calendar ──────────────
    const yahooEarningsRaw: any = Ycal?.earnings?.earningsDate?.[0];
    const nextEarnings: string | null = (() => {
      if (yahooEarningsRaw?.fmt) return String(yahooEarningsRaw.fmt);
      const ts =
        typeof yahooEarningsRaw?.raw === "number" ? yahooEarningsRaw.raw :
        typeof yahooEarningsRaw === "number" ? yahooEarningsRaw : null;
      if (ts != null) {
        const ms = ts < 1e10 ? ts * 1000 : ts;
        return new Date(ms).toISOString().slice(0, 10);
      }
      return null;
    })();
    const nextEPSEst = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ycal?.earnings?.earningsAverage) },
    ]);
    const nextRevEst = pick<number>([
      { source: "Yahoo", get: () => yRaw(Ycal?.earnings?.revenueAverage) },
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
    const filingTimeliness = checkFilingTimeliness(sec?.submissions || null);

    // ────────────── Company info (waterfall) ──────────────
    const companyName = pick<string>([
      { source: "Yahoo", get: () => yStr(Yprice?.longName) || yStr(Yprice?.shortName) },
      { source: "Polygon", get: () => PolyTicker?.name || null },
      { source: "SEC EDGAR", get: () => sec?.submissions?.name || null },
    ]);
    const sector = pick<string>([
      { source: "Yahoo", get: () => Yprof?.sector || null },
      { source: "Polygon", get: () => PolyTicker?.sic_description || null },
    ]);
    const industry = pick<string>([
      { source: "Yahoo", get: () => Yprof?.industry || null },
      { source: "Polygon", get: () => PolyTicker?.sic_description || null },
    ]);
    const country = pick<string>([
      { source: "Yahoo", get: () => Yprof?.country || null },
      { source: "Polygon", get: () => PolyTicker?.locale === "us" ? "United States" : (PolyTicker?.locale || null) },
    ]);
    const exchange = pick<string>([
      { source: "Yahoo", get: () => yStr(Yprice?.exchangeName) || Yprice?.exchange || null },
      { source: "Polygon", get: () => PolyTicker?.primary_exchange || null },
    ]);
    const website = pick<string>([
      { source: "Yahoo", get: () => Yprof?.website || null },
      { source: "Polygon", get: () => PolyTicker?.homepage_url || null },
    ]);
    const employees = pick<number>([
      { source: "Yahoo", get: () => yRaw(Yprof?.fullTimeEmployees) },
      { source: "Polygon", get: () => PolyTicker?.total_employees ?? null },
    ]);

    let descSource: "Yahoo" | "Polygon" | "Wikipedia" | null = null;
    let description: string | null = null;
    if (Yprof?.longBusinessSummary) { description = Yprof.longBusinessSummary; descSource = "Yahoo"; }
    else if (PolyTicker?.description) { description = PolyTicker.description; descSource = "Polygon"; }
    else {
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
      { k: "Analyst Consensus", v: consensusScore, s: consensusScore == null ? 5 : consensusScore <= 1.5 ? 10 : consensusScore <= 2.5 ? 7 : consensusScore <= 3.5 ? 4 : 1, source: consensusSource },
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

    // ────────────── Heuristic risks ──────────────
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

    // News merged from Polygon + Tiingo for the AI/news panel.
    const mergedNews = [
      ...(poly?.news || []).map((n: any) => ({
        title: n.title, url: n.article_url || n.url, publishedDate: n.published_utc,
        source: n.publisher?.name || "Polygon", description: n.description || null,
      })),
      ...(tg?.news || []).map((n: any) => ({
        title: n.title, url: n.url, publishedDate: n.publishedDate,
        source: n.source || "Tiingo", description: n.description || null,
      })),
    ].slice(0, 12);

    return {
      ticker, company,
      sources: ledger.toJSON(),
      sourceStatus: {
        yahoo: yahoo?.ok || false,
        yahooChart: !!chart,
        yahooRateLimited: isYahooRateLimited(),
        polygon: poly?.ok || false,
        polygonHasKey: poly?.hasKey || false,
        polygonRateLimited: poly?.rateLimited || false,
        polygonUnauthorized: poly?.unauthorized || false,
        tiingo: tg?.ok || false,
        tiingoHasKey: tg?.hasKey || false,
        tiingoRateLimited: tg?.rateLimited || false,
        tiingoUnauthorized: tg?.unauthorized || false,
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
        ratings: YrecTrend.slice(0, 6).map((rt: any) => {
          let dateIso: string | null = null;
          const period: string | undefined = rt?.period;
          if (typeof period === "string") {
            const m = /^(-?\d+)m$/.exec(period.trim());
            if (m) {
              const offset = parseInt(m[1], 10);
              const d = new Date();
              d.setMonth(d.getMonth() + offset);
              dateIso = d.toISOString().slice(0, 10);
            } else if (period.length >= 4 && !isNaN(new Date(period).getTime())) {
              dateIso = period;
            }
          }
          return {
            date: dateIso || period || "",
            buy: (rt.buy ?? 0) + (rt.strongBuy ?? 0),
            hold: rt.hold ?? 0,
            sell: (rt.sell ?? 0) + (rt.strongSell ?? 0),
          };
        }),
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
      news: mergedNews,
    };
  });

export type AnalysisResult = Awaited<ReturnType<typeof analyzeStock>>;
