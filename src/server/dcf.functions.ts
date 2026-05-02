// DCF Valuation server functions.
//
// Two functions:
//   computeDCF — pure DCF model. Refetches Polygon + Tiingo + FRED, builds
//                historical financials, applies user overrides, returns full
//                payload for the UI.
//   dcfMemo    — calls Anthropic Claude to produce an investment memo.

import { createServerFn } from "@tanstack/react-start";
import { fetchPolygonBundle, polyFinValue, polyBeta } from "./sources/polygon.server";
import { fetchTiingoBundle, tgDaily, tgOverview } from "./sources/tiingo.server";
import { fetchFredBundle } from "./sources/fred.server";
import {
  detectMarket,
  MARKET_CURRENCY,
  CURRENCY_SYMBOL,
  MARKET_TENYEAR_LABEL,
  SECTOR_MEDIANS_EUROPE,
  polygonLocale,
} from "@/lib/markets";

// ─── Types ───────────────────────────────────────────────────────────

export type DCFOverrides = {
  terminalGrowthRate?: number;
  exitMultiple?: number;
  capexPctRevenue?: number;
  bearMultiplier?: number;
  bullMultiplier?: number;
};

export type Scenario = "bear" | "base" | "bull";

export type DCFInput = {
  ticker: string;
  overrides?: DCFOverrides;
};

type Trend = "up" | "down" | "flat";
type HistRow = {
  fyLabel: string;
  revenue: number | null;
  revenueGrowthYoY: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  ebitda: number | null;
  ebitdaMargin: number | null;
  ebit: number | null;
  opMargin: number | null;
  netIncome: number | null;
  netMargin: number | null;
  capex: number | null;
  fcf: number | null;
  fcfMargin: number | null;
  fcfConversion: number | null;
};

type ProjectionRow = {
  year: number;
  revenueGrowth: number;
  revenue: number;
  ebitdaMargin: number;
  ebitda: number;
  da: number;
  ebit: number;
  taxes: number;
  nopat: number;
  capex: number;
  changeWC: number;
  fcf: number;
  discountFactor: number;
  pvFCF: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────

function safe(v: number | null | undefined): number | null {
  if (v == null || !isFinite(v as number)) return null;
  return v as number;
}
function trendOf(curr: number | null, prev: number | null): Trend {
  if (curr == null || prev == null) return "flat";
  const diff = curr - prev;
  const eps = Math.max(Math.abs(prev) * 0.01, 1e-9);
  if (diff > eps) return "up";
  if (diff < -eps) return "down";
  return "flat";
}
function cagr(start: number | null, end: number | null, years: number): number | null {
  if (!start || !end || start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

function extractHistoricals(polyFinancials: any[] | undefined): HistRow[] {
  if (!polyFinancials?.length) return [];
  const ordered = [...polyFinancials].reverse(); // oldest-first
  const rows: HistRow[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i]?.financials;
    const inc = f?.income_statement;
    const cf = f?.cash_flow_statement;
    const period = ordered[i]?.fiscal_period || ordered[i]?.fiscal_year || `FY-${ordered.length - 1 - i}`;
    const fyLabel = String(period);

    const revenue = safe(polyFinValue(inc, "revenues"));
    const grossProfit = safe(polyFinValue(inc, "gross_profit"));
    const opIncome = safe(polyFinValue(inc, "operating_income_loss"));
    const netIncome = safe(polyFinValue(inc, "net_income_loss"));
    const da = safe(polyFinValue(cf, "depreciation_and_amortization"));
    const capexRaw = safe(polyFinValue(cf, "capital_expenditure"));
    const capex = capexRaw != null ? -Math.abs(capexRaw) : null;
    const ocf = safe(polyFinValue(cf, "net_cash_flow_from_operating_activities"));

    const ebitda = opIncome != null && da != null ? opIncome + da : null;
    const fcf = ocf != null && capex != null ? ocf + capex : null;

    rows.push({
      fyLabel,
      revenue,
      revenueGrowthYoY: null,
      grossProfit,
      grossMargin: revenue && grossProfit != null ? grossProfit / revenue : null,
      ebitda,
      ebitdaMargin: revenue && ebitda != null ? ebitda / revenue : null,
      ebit: opIncome,
      opMargin: revenue && opIncome != null ? opIncome / revenue : null,
      netIncome,
      netMargin: revenue && netIncome != null ? netIncome / revenue : null,
      capex,
      fcf,
      fcfMargin: revenue && fcf != null ? fcf / revenue : null,
      fcfConversion: netIncome && fcf != null ? fcf / netIncome : null,
    });
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].revenue;
    const curr = rows[i].revenue;
    rows[i].revenueGrowthYoY = prev && curr ? (curr - prev) / Math.abs(prev) : null;
  }
  while (rows.length < 4) {
    rows.unshift({
      fyLabel: "—",
      revenue: null, revenueGrowthYoY: null, grossProfit: null, grossMargin: null,
      ebitda: null, ebitdaMargin: null, ebit: null, opMargin: null,
      netIncome: null, netMargin: null, capex: null, fcf: null,
      fcfMargin: null, fcfConversion: null,
    });
  }
  const last4 = rows.slice(-4);
  last4[0].fyLabel = "FY-3";
  last4[1].fyLabel = "FY-2";
  last4[2].fyLabel = "FY-1";
  last4[3].fyLabel = "LTM";
  return last4;
}

function computeTrends(hist: HistRow[]): Record<string, Trend[]> {
  const keys: (keyof Omit<HistRow, "fyLabel">)[] = [
    "revenue", "revenueGrowthYoY", "grossProfit", "grossMargin",
    "ebitda", "ebitdaMargin", "ebit", "opMargin",
    "netIncome", "netMargin", "capex", "fcf", "fcfMargin", "fcfConversion",
  ];
  const out: Record<string, Trend[]> = {};
  for (const k of keys) {
    const trends: Trend[] = [];
    for (let i = 0; i < hist.length; i++) {
      if (i === 0) { trends.push("flat"); continue; }
      let t = trendOf(hist[i][k] as number | null, hist[i - 1][k] as number | null);
      if (k === "capex" && t !== "flat") t = t === "up" ? "down" : "up";
      trends.push(t);
    }
    out[k as string] = trends;
  }
  return out;
}

function fadeGrowth(startRate: number, terminalRate: number, year: number, totalYears: number): number {
  const f = year / totalYears;
  return startRate * (1 - f) + terminalRate * f;
}

function projectScenario(opts: {
  baseRevenue: number;
  baseGrowth: number;
  terminalGrowth: number;
  ebitdaMarginLTM: number;
  daPctRevenue: number;
  capexPctRevenue: number;
  wcChangePctRevenue: number;
  taxRate: number;
  wacc: number;
  growthMultiplier: number;
  marginExpansion: number;
}): ProjectionRow[] {
  const { baseRevenue, baseGrowth, terminalGrowth, ebitdaMarginLTM, daPctRevenue,
    capexPctRevenue, wcChangePctRevenue, taxRate, wacc,
    growthMultiplier, marginExpansion } = opts;

  const rows: ProjectionRow[] = [];
  let revenue = baseRevenue;
  for (let y = 1; y <= 5; y++) {
    const g = fadeGrowth(baseGrowth * growthMultiplier, terminalGrowth, y - 1, 4);
    revenue = revenue * (1 + g);
    const margin = ebitdaMarginLTM + (marginExpansion * (y / 5));
    const ebitda = revenue * margin;
    const da = revenue * daPctRevenue;
    const ebit = ebitda - da;
    const taxes = Math.max(0, ebit * taxRate);
    const nopat = ebit - taxes;
    const capex = revenue * capexPctRevenue;
    const changeWC = revenue * wcChangePctRevenue;
    const fcf = nopat + da - capex - changeWC;
    const discountFactor = 1 / Math.pow(1 + wacc, y);
    const pvFCF = fcf * discountFactor;
    rows.push({
      year: y, revenueGrowth: g, revenue, ebitdaMargin: margin, ebitda, da, ebit,
      taxes, nopat, capex, changeWC, fcf, discountFactor, pvFCF,
    });
  }
  return rows;
}

const sumPV = (rows: ProjectionRow[]) => rows.reduce((s, r) => s + r.pvFCF, 0);

function impliedPrice(args: {
  projection: ProjectionRow[];
  wacc: number;
  terminalGrowth: number;
  exitMultiple: number;
  netDebt: number;
  diluted: number;
}): { ev: number; equity: number; price: number; pvTermBlended: number; sumPV: number } {
  const { projection, wacc, terminalGrowth, exitMultiple, netDebt, diluted } = args;
  const last = projection[projection.length - 1];
  const tvMultiple = last.ebitda * exitMultiple;
  const pvTvMultiple = tvMultiple / Math.pow(1 + wacc, projection.length);
  const tvGGM = wacc > terminalGrowth
    ? (last.fcf * (1 + terminalGrowth)) / (wacc - terminalGrowth)
    : 0;
  const pvTvGGM = tvGGM / Math.pow(1 + wacc, projection.length);
  const pvTermBlended = (pvTvMultiple + pvTvGGM) / 2;
  const totalPV = sumPV(projection);
  const ev = totalPV + pvTermBlended;
  const equity = ev - netDebt;
  const price = diluted > 0 ? equity / diluted : 0;
  return { ev, equity, price, pvTermBlended, sumPV: totalPV };
}

// ─── Main: computeDCF ────────────────────────────────────────────────

export const computeDCF = createServerFn({ method: "POST" })
  .inputValidator((d: DCFInput) => {
    const t = (d?.ticker || "").trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,12}$/.test(t)) throw new Error("Invalid ticker");
    const o = d?.overrides || {};
    return {
      ticker: t,
      overrides: {
        terminalGrowthRate: typeof o.terminalGrowthRate === "number" ? o.terminalGrowthRate : undefined,
        exitMultiple: typeof o.exitMultiple === "number" ? o.exitMultiple : undefined,
        capexPctRevenue: typeof o.capexPctRevenue === "number" ? o.capexPctRevenue : undefined,
        bearMultiplier: typeof o.bearMultiplier === "number" ? o.bearMultiplier : undefined,
        bullMultiplier: typeof o.bullMultiplier === "number" ? o.bullMultiplier : undefined,
      } as DCFOverrides,
    };
  })
  .handler(async ({ data }) => {
    const { ticker, overrides } = data;
    const market = detectMarket(ticker);
    const currency = MARKET_CURRENCY[market];
    const symbol = CURRENCY_SYMBOL[currency];
    const isUS = market === "US";

    const proxies: string[] = [];

    const [polyR, tgR, fredR] = await Promise.allSettled([
      fetchPolygonBundle(ticker, { locale: polygonLocale(market) }),
      fetchTiingoBundle(ticker),
      fetchFredBundle(),
    ]);
    const poly = polyR.status === "fulfilled" ? polyR.value : null;
    const tg = tgR.status === "fulfilled" ? tgR.value : null;
    const fred = fredR.status === "fulfilled" ? fredR.value : null;

    if (!poly?.ok || !poly?.financials?.length) {
      throw new Error("DCF requires Polygon historical financials, which are unavailable for this ticker.");
    }

    const hist = extractHistoricals(poly.financials);
    const trends = computeTrends(hist);
    const ltm = hist[hist.length - 1];
    if (!ltm.revenue || ltm.revenue <= 0) {
      throw new Error("DCF requires positive LTM revenue.");
    }

    const companyName: string = poly.ticker?.name || ticker;
    const sector: string | null = poly.ticker?.sic_description || null;
    const fye: string | null = poly.financials?.[0]?.fiscal_year || poly.financials?.[0]?.end_date || null;

    const polyDayClose = poly.snapshot?.day?.c;
    const polyPrevDayClose = poly.snapshot?.prevDay?.c;
    const polyMinClose = poly.snapshot?.min?.c;
    const tgLastClose = tg?.eod?.length ? tg.eod[tg.eod.length - 1]?.close : null;
    const currentPrice =
      (polyDayClose && polyDayClose > 0 ? polyDayClose : null) ??
      (poly.snapshot?.lastTrade?.p && poly.snapshot.lastTrade.p > 0 ? poly.snapshot.lastTrade.p : null) ??
      (polyMinClose && polyMinClose > 0 ? polyMinClose : null) ??
      (polyPrevDayClose && polyPrevDayClose > 0 ? polyPrevDayClose : null) ??
      (poly.trades?.price && poly.trades.price > 0 ? poly.trades.price : null) ??
      (poly.aggs?.length ? poly.aggs[poly.aggs.length - 1]?.close : null) ??
      (tgLastClose && tgLastClose > 0 ? tgLastClose : null) ??
      null;
    if (!currentPrice || currentPrice <= 0) {
      throw new Error("Current price unavailable from Polygon snapshot or Tiingo EOD.");
    }
    let dilutedShares: number = (
      poly.ticker?.weighted_shares_outstanding ||
      poly.ticker?.share_class_shares_outstanding ||
      0
    ) as number;
    if (!dilutedShares && poly.ticker?.market_cap) {
      dilutedShares = poly.ticker.market_cap / currentPrice;
      proxies.push("Diluted shares estimated from Market Cap / Price");
    }
    if (!dilutedShares) {
      throw new Error("Diluted shares outstanding unavailable.");
    }
    const marketCap = currentPrice * dilutedShares;

    const bal = poly.financials?.[0]?.financials?.balance_sheet;
    const totalDebtRaw = safe(polyFinValue(bal, "long_term_debt"))
      ?? safe(polyFinValue(bal, "liabilities"));
    if (totalDebtRaw == null) proxies.push("Total Debt approximated from total liabilities");
    const totalDebt = totalDebtRaw ?? 0;
    const cash = safe(polyFinValue(bal, "cash")) ?? 0;
    if (cash === 0) proxies.push("Cash unavailable — net debt may be overstated");
    const netDebt = totalDebt - cash;

    const incLatest = poly.financials?.[0]?.financials?.income_statement;
    const interestExpense = Math.abs(safe(polyFinValue(incLatest, "interest_expense_operating"))
      ?? safe(polyFinValue(incLatest, "interest_expense")) ?? 0);
    const ebitLatest = ltm.ebit ?? 0;
    const niLatest = ltm.netIncome ?? 0;

    let taxRate = 0.21;
    if (ebitLatest > 0 && niLatest > 0 && ebitLatest > niLatest) {
      taxRate = Math.max(0.10, Math.min(0.35, 1 - niLatest / ebitLatest));
    } else {
      proxies.push("Tax rate set to 21% statutory (effective rate not derivable)");
    }

    const country10y = fred?.series?.DGS10?.current ?? null;
    const riskFreeRate = (country10y != null ? country10y : 4.0) / 100;
    if (country10y == null) proxies.push("Risk-free rate defaulted to 4.0%");

    let beta: number | null = null;
    if (isUS) beta = polyBeta(poly.aggs, poly.spyAggs);
    if (beta == null) {
      beta = 1.0;
      proxies.push(`Beta defaulted to 1.0 (no ${isUS ? "calculable" : "regional benchmark"} beta)`);
    }
    const equityRiskPremium = isUS ? 0.055 : 0.050;
    const costOfEquity = riskFreeRate + beta * equityRiskPremium;

    let preTaxCostOfDebt: number;
    if (totalDebt > 0 && interestExpense > 0) {
      preTaxCostOfDebt = Math.max(0.02, Math.min(0.15, interestExpense / totalDebt));
    } else {
      preTaxCostOfDebt = riskFreeRate + 0.015;
      proxies.push("Cost of debt defaulted to risk-free + 150bp");
    }
    const afterTaxCostOfDebt = preTaxCostOfDebt * (1 - taxRate);

    const totalCapital = marketCap + totalDebt;
    const wEquity = totalCapital > 0 ? marketCap / totalCapital : 1;
    const wDebt = totalCapital > 0 ? totalDebt / totalCapital : 0;
    const wacc = wEquity * costOfEquity + wDebt * afterTaxCostOfDebt;

    const histCAGR3 = cagr(hist[0].revenue, hist[3].revenue, 3) ?? 0.05;
    const tgRevG1 = tgOverview(tg, "revenueGrowth");
    const tgRevG2 = tgDaily(tg, "revenueGrowth");
    let analystGrowth: number | null =
      (typeof tgRevG1 === "number" && isFinite(tgRevG1)) ? tgRevG1 :
      (typeof tgRevG2 === "number" && isFinite(tgRevG2)) ? tgRevG2 : null;
    if (analystGrowth == null) {
      analystGrowth = histCAGR3;
      proxies.push("Analyst forward growth unavailable — using 3y historical CAGR");
    }
    const sectorGrowthMap: Record<string, number> = {
      Technology: 0.10, Healthcare: 0.08, Financials: 0.05, "Financial Services": 0.05,
      "Consumer Discretionary": 0.06, "Consumer Cyclical": 0.06,
      "Consumer Staples": 0.04, "Consumer Defensive": 0.04,
      Industrials: 0.05, Energy: 0.03, Materials: 0.04, "Basic Materials": 0.04,
      Utilities: 0.03, "Real Estate": 0.04, "Communication Services": 0.06,
    };
    const sectorGrowth: number = (sector ? sectorGrowthMap[sector] : undefined) ?? 0.05;
    const baseGrowthY1 = histCAGR3 * 0.4 + analystGrowth * 0.4 + sectorGrowth * 0.2;

    const ebitdaMarginLTM = ltm.ebitdaMargin ?? 0.15;
    const cf = poly.financials?.[0]?.financials?.cash_flow_statement;
    const daLatest = safe(polyFinValue(cf, "depreciation_and_amortization")) ?? 0;
    const daPctRevenue = ltm.revenue ? daLatest / ltm.revenue : 0.05;
    const capexLatest = ltm.capex ?? 0;
    const capexPctRevenueLTM = ltm.revenue ? Math.abs(capexLatest) / ltm.revenue : 0.05;
    const wcChangePctRevenue = 0.02;
    proxies.push("Working capital change proxied at 2% of revenue");

    const terminalGrowth = overrides.terminalGrowthRate ?? 0.025;
    const exitMultipleDefault = (() => {
      const sectorMedians = isUS
        ? { Technology: 18, Healthcare: 14, Financials: 9, "Financial Services": 9,
            "Consumer Discretionary": 12, "Consumer Cyclical": 12,
            "Consumer Staples": 13, "Consumer Defensive": 13,
            Industrials: 11, Energy: 7, Materials: 8, "Basic Materials": 8,
            Utilities: 11, "Real Estate": 18, "Communication Services": 13 } as Record<string, number>
        : SECTOR_MEDIANS_EUROPE;
      return (sector ? sectorMedians[sector] : undefined) ?? 12;
    })();
    const exitMultiple = overrides.exitMultiple ?? exitMultipleDefault;
    const capexPctRevenue = overrides.capexPctRevenue ?? capexPctRevenueLTM;
    const bearMult = overrides.bearMultiplier ?? 0.65;
    const bullMult = overrides.bullMultiplier ?? 1.40;

    const baseInputs = {
      baseRevenue: ltm.revenue!,
      baseGrowth: baseGrowthY1,
      terminalGrowth,
      ebitdaMarginLTM,
      daPctRevenue,
      capexPctRevenue,
      wcChangePctRevenue,
      taxRate,
      wacc,
    };
    const projBear = projectScenario({ ...baseInputs, growthMultiplier: bearMult, marginExpansion: -0.005 });
    const projBase = projectScenario({ ...baseInputs, growthMultiplier: 1.0, marginExpansion: +0.010 });
    const projBull = projectScenario({ ...baseInputs, growthMultiplier: bullMult, marginExpansion: +0.020 });

    const priceBear = impliedPrice({ projection: projBear, wacc, terminalGrowth, exitMultiple, netDebt, diluted: dilutedShares });
    const priceBase = impliedPrice({ projection: projBase, wacc, terminalGrowth, exitMultiple, netDebt, diluted: dilutedShares });
    const priceBull = impliedPrice({ projection: projBull, wacc, terminalGrowth, exitMultiple, netDebt, diluted: dilutedShares });

    const lastBase = projBase[projBase.length - 1];
    const tvMultiple = lastBase.ebitda * exitMultiple;
    const pvTvMultiple = tvMultiple / Math.pow(1 + wacc, 5);
    const tvGGM = wacc > terminalGrowth ? (lastBase.fcf * (1 + terminalGrowth)) / (wacc - terminalGrowth) : 0;
    const pvTvGGM = tvGGM / Math.pow(1 + wacc, 5);
    const pvTermBlended = (pvTvMultiple + pvTvGGM) / 2;
    const evBase = priceBase.sumPV + pvTermBlended;
    const pctMultiple = evBase > 0 ? pvTvMultiple / evBase : 0;
    const pctGGM = evBase > 0 ? pvTvGGM / evBase : 0;

    const waccRange = [-0.02, -0.01, 0, 0.01, 0.02].map(d => Math.max(0.03, wacc + d));
    const tgrRange = [0.015, 0.020, 0.025, 0.030, 0.035];
    const sensA = waccRange.map(w =>
      tgrRange.map(g => {
        const proj = projectScenario({ ...baseInputs, wacc: w, terminalGrowth: g, growthMultiplier: 1.0, marginExpansion: 0.010 });
        return impliedPrice({ projection: proj, wacc: w, terminalGrowth: g, exitMultiple, netDebt, diluted: dilutedShares }).price;
      })
    );

    const growthMultipliers = [bearMult, 0.85, 1.0, 1.15, bullMult];
    const marginOffsets = [-0.02, -0.01, 0, 0.01, 0.02];
    const sensB = growthMultipliers.map(gm =>
      marginOffsets.map(mo => {
        const proj = projectScenario({
          ...baseInputs,
          ebitdaMarginLTM: ebitdaMarginLTM + mo,
          growthMultiplier: gm,
          marginExpansion: 0.010,
        });
        return impliedPrice({ projection: proj, wacc, terminalGrowth, exitMultiple, netDebt, diluted: dilutedShares }).price;
      })
    );

    const high52 = poly.aggs?.length ? Math.max(...poly.aggs.map(a => a.high)) : null;
    const low52 = poly.aggs?.length ? Math.min(...poly.aggs.map(a => a.low)) : null;
    const footballField = [
      { label: "DCF (Bear–Bull)", low: priceBear.price, high: priceBull.price, mid: priceBase.price },
      { label: "Exit Multiple", low: priceBase.price * 0.85, high: priceBase.price * 1.15, mid: priceBase.price },
      { label: "Perpetuity Growth", low: priceBase.price * 0.80, high: priceBase.price * 1.20, mid: priceBase.price },
      { label: "52-Week Range", low: low52 ?? currentPrice, high: high52 ?? currentPrice, mid: currentPrice },
    ].filter(b => isFinite(b.low) && isFinite(b.high) && b.high >= b.low);

    const premiumBase = (priceBase.price - currentPrice) / currentPrice;

    const assumptions = [
      { label: "Risk-Free Rate", value: `${(riskFreeRate * 100).toFixed(2)}%`, source: `FRED ${MARKET_TENYEAR_LABEL[market]} (DGS10)`, editable: false, key: null as null | string },
      { label: "Equity Risk Premium", value: `${(equityRiskPremium * 100).toFixed(2)}%`, source: "Damodaran 2025", editable: false, key: null },
      { label: "Beta", value: beta.toFixed(2), source: isUS ? (polyBeta(poly.aggs, poly.spyAggs) != null ? "Calculated vs SPY" : "Default 1.0") : "Default 1.0 (no EU benchmark)", editable: false, key: null },
      { label: "Cost of Equity", value: `${(costOfEquity * 100).toFixed(2)}%`, source: "CAPM", editable: false, key: null },
      { label: "After-tax Cost of Debt", value: `${(afterTaxCostOfDebt * 100).toFixed(2)}%`, source: totalDebt > 0 && interestExpense > 0 ? "Implied from interest expense" : "RF + 150bp proxy", editable: false, key: null },
      { label: "WACC", value: `${(wacc * 100).toFixed(2)}%`, source: "Computed", editable: false, key: null },
      { label: "Tax Rate", value: `${(taxRate * 100).toFixed(1)}%`, source: ebitLatest > 0 && niLatest > 0 ? "Effective rate (EBIT vs NI)" : "21% statutory", editable: false, key: null },
      { label: "Terminal Growth Rate", value: `${(terminalGrowth * 100).toFixed(2)}%`, source: "Hardcoded (long-run nominal GDP)", editable: true, key: "terminalGrowthRate" },
      { label: "Exit Multiple (EV/EBITDA)", value: `${(exitMultiple as number).toFixed(1)}x`, source: sector ? `Sector median: ${sector}` : "Default", editable: true, key: "exitMultiple" },
      { label: "CapEx as % of Revenue", value: `${(capexPctRevenue * 100).toFixed(2)}%`, source: "LTM", editable: true, key: "capexPctRevenue" },
      { label: "D&A as % of Revenue", value: `${(daPctRevenue * 100).toFixed(2)}%`, source: "LTM", editable: false, key: null },
      { label: "Working Capital Change %", value: `${(wcChangePctRevenue * 100).toFixed(2)}%`, source: "Industry proxy", editable: false, key: null },
      { label: "Bear Growth Multiplier", value: `${bearMult.toFixed(2)}x`, source: "Hardcoded", editable: true, key: "bearMultiplier" },
      { label: "Bull Growth Multiplier", value: `${bullMult.toFixed(2)}x`, source: "Hardcoded", editable: true, key: "bullMultiplier" },
      { label: "Base Growth Y1 (blended)", value: `${(baseGrowthY1 * 100).toFixed(2)}%`, source: "40% historical CAGR + 40% analyst + 20% sector", editable: false, key: null },
    ];

    return {
      ticker,
      companyName,
      sector,
      currency,
      currencySymbol: symbol,
      fyEnd: fye,
      preparedAt: new Date().toISOString(),
      currentPrice,
      dilutedShares,
      marketCap,
      netDebt,
      totalDebt,
      cash,
      historicals: hist,
      historicalsTrends: trends,
      wacc: {
        riskFreeRate, beta, equityRiskPremium, costOfEquity,
        totalDebt, interestExpense, preTaxCostOfDebt, taxRate, afterTaxCostOfDebt,
        marketCap, totalCapital, wEquity, wDebt, wacc,
        country10yLabel: MARKET_TENYEAR_LABEL[market],
      },
      projection: {
        bear: projBear,
        base: projBase,
        bull: projBull,
        baseGrowthY1,
      },
      terminalValue: {
        terminalEBITDA: lastBase.ebitda,
        terminalFCF: lastBase.fcf,
        exitMultiple,
        terminalGrowth,
        tvMultiple,
        tvGGM,
        pvTvMultiple,
        pvTvGGM,
        pvTermBlended,
        pctMultiple,
        pctGGM,
      },
      bridge: {
        sumPV: priceBase.sumPV,
        pvTerminal: pvTermBlended,
        ev: priceBase.ev,
        netDebt,
        equity: priceBase.equity,
        diluted: dilutedShares,
        impliedPrice: priceBase.price,
        currentPrice,
        premiumPct: premiumBase,
      },
      scenarios: {
        bear: priceBear.price,
        base: priceBase.price,
        bull: priceBull.price,
      },
      sensitivity: {
        waccRange, tgrRange, sensA,
        growthLabels: ["Bear", "-1%", "Base", "+1%", "Bull"],
        marginOffsets, sensB,
      },
      footballField,
      high52, low52,
      assumptions,
      dataQuality: {
        proxyCount: proxies.length,
        proxies,
        limited: proxies.length >= 3,
      },
      overrides,
    };
  });

export type DCFResult = Awaited<ReturnType<typeof computeDCF>>;

// ─── AI Memo (Anthropic Claude) ──────────────────────────────────────

export const dcfMemo = createServerFn({ method: "POST" })
  .inputValidator((d: { dcf: DCFResult }) => {
    if (!d?.dcf?.ticker) throw new Error("DCF payload required");
    return d;
  })
  .handler(async ({ data }) => {
    const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    if (!apiKey) {
      return {
        ok: false,
        memo: null,
        error: "ANTHROPIC_API_KEY not configured. Set it in project settings to enable the AI memo.",
      };
    }

    const dcf = data.dcf;
    const fmt = (v: number) => `${dcf.currencySymbol}${v.toFixed(2)}`;
    const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
    const mn = (v: number) => `${dcf.currencySymbol}${(v / 1e6).toFixed(1)}M`;

    const ltm = dcf.historicals[dcf.historicals.length - 1];
    const y5 = dcf.projection.base[4];
    const revCAGR = cagr(ltm.revenue ?? 0, y5.revenue, 5);

    const prompt = `You are a VP-level investment banker at Morgan Stanley building a valuation memo for an M&A fairness opinion.

Company: ${dcf.companyName} (${dcf.ticker})
Sector: ${dcf.sector || "N/A"}
Current Price: ${fmt(dcf.currentPrice)}
DCF Implied Price (Base): ${fmt(dcf.bridge.impliedPrice)}
Premium/(Discount): ${pct(dcf.bridge.premiumPct)}
WACC: ${pct(dcf.wacc.wacc)}
Terminal Growth Rate: ${pct(dcf.terminalValue.terminalGrowth)}
Exit Multiple: ${dcf.terminalValue.exitMultiple.toFixed(1)}x
5Y Revenue CAGR (Base): ${revCAGR != null ? pct(revCAGR) : "N/A"}
EBITDA Margin (LTM -> Y5): ${pct(ltm.ebitdaMargin ?? 0)} -> ${pct(y5.ebitdaMargin)}
Net Debt: ${mn(dcf.netDebt)}
Bear Case Price: ${fmt(dcf.scenarios.bear)}
Bull Case Price: ${fmt(dcf.scenarios.bull)}
Beta: ${dcf.wacc.beta.toFixed(2)}
Cost of Equity: ${pct(dcf.wacc.costOfEquity)}

Write a formal valuation memo with these sections:
1. EXECUTIVE SUMMARY (3 sentences max — verdict and key number)
2. KEY VALUE DRIVERS (3 bullet points — what drives the bull case)
3. KEY RISKS TO THE MODEL (3 bullet points — what breaks the bear case)
4. CRITICAL ASSUMPTIONS (table format: assumption | value used | sensitivity)
5. VERDICT: UNDERVALUED / FAIRLY VALUED / OVERVALUED with one-paragraph rationale

Use investment banking language. Be precise. No hedging language — take a clear position.
Format in clean markdown with headers. Max 400 words.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        return { ok: false, memo: null, error: `Anthropic API error ${res.status}: ${txt.slice(0, 200)}` };
      }
      const json: any = await res.json();
      const memo = json?.content?.[0]?.text || "";
      return { ok: true, memo, error: null };
    } catch (e: any) {
      return { ok: false, memo: null, error: `Memo request failed: ${e?.message || "unknown"}` };
    }
  });
