import { useEffect, useMemo, useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { computeDCF, dcfMemo, type DCFResult, type DCFOverrides } from "@/server/dcf.functions";
import { Button } from "@/components/ui/button";

type Props = { ticker: string };

const fmtMoney = (v: number | null | undefined, sym: string, dp = 0) =>
  v == null || !isFinite(v) ? "—" : `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const fmtMn = (v: number | null | undefined, sym: string) =>
  v == null || !isFinite(v) ? "—" : `${sym}${(v / 1e6).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
const fmtPct = (v: number | null | undefined, dp = 1) =>
  v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`;
const fmtX = (v: number | null | undefined, dp = 1) =>
  v == null || !isFinite(v) ? "—" : `${v.toFixed(dp)}x`;

const trendIcon = (t: "up" | "down" | "flat") =>
  t === "up" ? <span className="text-success">▲</span> : t === "down" ? <span className="text-danger">▼</span> : <span className="text-muted-foreground">→</span>;

function priceCellTone(price: number, current: number) {
  const diff = (price - current) / current;
  if (diff > 0.10) return "bg-success/15 text-success";
  if (diff < -0.10) return "bg-danger/15 text-danger";
  return "bg-warning/15 text-warning";
}

export function DCFAnalysis({ ticker }: Props) {
  const [overrides, setOverrides] = useState<DCFOverrides>({});
  const [pendingOverrides, setPendingOverrides] = useState<DCFOverrides>({});
  const debounceRef = useRef<number | null>(null);

  const dcfMut = useMutation({
    mutationFn: async (o: DCFOverrides) => {
      return await computeDCF({ data: { ticker, overrides: o } });
    },
    // Consume the rejection so the dev runtime-error overlay does not flag
    // expected DCF failures (e.g. Polygon snapshot empty, no historicals).
    onError: (err) => {
      console.warn("[DCF] compute failed:", (err as Error)?.message);
    },
  });
  const memoMut = useMutation({
    mutationFn: async (dcf: DCFResult) => {
      return await dcfMemo({ data: { dcf } });
    },
    onError: (err) => {
      console.warn("[DCF memo] failed:", (err as Error)?.message);
    },
  });

  // Initial fetch + refetch on ticker change
  useEffect(() => {
    setOverrides({});
    setPendingOverrides({});
    dcfMut.mutate({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // Debounced server recompute on assumption edits
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (Object.keys(pendingOverrides).length === 0) return;
    debounceRef.current = window.setTimeout(() => {
      setOverrides(pendingOverrides);
      dcfMut.mutate(pendingOverrides);
    }, 500);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOverrides]);

  const dcf = dcfMut.data;

  if (dcfMut.isPending && !dcf) {
    return (
      <section className="glass-card p-6">
        <h2 className="text-xl font-bold mb-2">Section 5 · DCF Valuation Analysis</h2>
        <p className="text-sm text-muted-foreground">Building discounted cash flow model…</p>
      </section>
    );
  }
  if (dcfMut.isError) {
    return (
      <section className="glass-card p-6">
        <h2 className="text-xl font-bold mb-2">Section 5 · DCF Valuation Analysis</h2>
        <p className="text-sm text-danger">{(dcfMut.error as Error)?.message || "DCF unavailable for this ticker."}</p>
      </section>
    );
  }
  if (!dcf) return null;

  const sym = dcf.currencySymbol;
  const cur = dcf.currentPrice;

  const handleOverride = (key: keyof DCFOverrides, raw: string) => {
    const num = parseFloat(raw);
    if (!isFinite(num)) return;
    let v = num;
    if (key === "terminalGrowthRate" || key === "capexPctRevenue") v = num / 100;
    setPendingOverrides({ ...overrides, [key]: v });
  };

  return (
    <section className="glass-card p-6 space-y-8 print:space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold">Section 5 · DCF Valuation Analysis</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {dcf.companyName} ({dcf.ticker}) · {dcf.sector || "—"} · FYE {dcf.fyEnd || "—"} ·
            Currency: {dcf.currency} · Prepared: {new Date(dcf.preparedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dcf.dataQuality.limited && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-warning/20 text-warning border border-warning/40 rounded px-2 py-1"
              title={dcf.dataQuality.proxies.join("\n")}>
              ⚠️ Data Quality: Limited ({dcf.dataQuality.proxyCount} proxies)
            </span>
          )}
          {dcfMut.isPending && <span className="text-[10px] text-muted-foreground">Recomputing…</span>}
        </div>
      </div>

      {/* BLOCK 1 — Historical Financials */}
      <Block title="1 · Historical Financials & Trends">
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left p-2">Metric</th>
                {dcf.historicals.map((h, i) => (
                  <th key={i} className="text-right p-2">{h.fyLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                ["Revenue", "revenue", (v: any) => fmtMn(v, sym)],
                ["YoY Growth", "revenueGrowthYoY", (v: any) => fmtPct(v, 1)],
                ["Gross Profit", "grossProfit", (v: any) => fmtMn(v, sym)],
                ["Gross Margin", "grossMargin", (v: any) => fmtPct(v, 1)],
                ["EBITDA", "ebitda", (v: any) => fmtMn(v, sym)],
                ["EBITDA Margin", "ebitdaMargin", (v: any) => fmtPct(v, 1)],
                ["EBIT", "ebit", (v: any) => fmtMn(v, sym)],
                ["Operating Margin", "opMargin", (v: any) => fmtPct(v, 1)],
                ["Net Income", "netIncome", (v: any) => fmtMn(v, sym)],
                ["Net Margin", "netMargin", (v: any) => fmtPct(v, 1)],
                ["CapEx", "capex", (v: any) => fmtMn(v, sym)],
                ["Free Cash Flow", "fcf", (v: any) => fmtMn(v, sym)],
                ["FCF Margin", "fcfMargin", (v: any) => fmtPct(v, 1)],
                ["FCF / NI Conversion", "fcfConversion", (v: any) => fmtPct(v, 0)],
              ] as const).map(([label, key, fmt]) => (
                <tr key={key} className="border-b border-border/40">
                  <td className="p-2 text-muted-foreground">{label}</td>
                  {dcf.historicals.map((h, i) => {
                    const v = (h as any)[key];
                    const t = dcf.historicalsTrends[key]?.[i] || "flat";
                    return (
                      <td key={i} className="p-2 text-right">
                        <span className="inline-flex items-center gap-1 justify-end">
                          {i > 0 && trendIcon(t)}
                          {fmt(v)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      {/* BLOCK 2 — WACC */}
      <Block title="2 · WACC Build-up">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <table className="w-full tabular-nums">
            <tbody>
              {[
                ["Risk-free rate", fmtPct(dcf.wacc.riskFreeRate, 2), `FRED ${dcf.wacc.country10yLabel}`],
                ["Beta", dcf.wacc.beta.toFixed(2), "vs benchmark"],
                ["Equity risk premium", fmtPct(dcf.wacc.equityRiskPremium, 2), "Damodaran 2025"],
                ["Cost of equity (CAPM)", fmtPct(dcf.wacc.costOfEquity, 2), "Rf + β × ERP"],
                ["Pre-tax cost of debt", fmtPct(dcf.wacc.preTaxCostOfDebt, 2), "Implied"],
                ["Tax rate", fmtPct(dcf.wacc.taxRate, 1), "Effective / statutory"],
                ["After-tax cost of debt", fmtPct(dcf.wacc.afterTaxCostOfDebt, 2), "Kd × (1−t)"],
              ].map(([k, v, src]) => (
                <tr key={k as string} className="border-b border-border/40">
                  <td className="p-2 text-muted-foreground">{k}</td>
                  <td className="p-2 text-right font-medium">{v}</td>
                  <td className="p-2 text-right text-[10px] text-muted-foreground">{src}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full tabular-nums">
            <tbody>
              {[
                ["Market cap", fmtMn(dcf.wacc.marketCap, sym)],
                ["Total debt", fmtMn(dcf.wacc.totalDebt, sym)],
                ["Total capital", fmtMn(dcf.wacc.totalCapital, sym)],
                ["Weight: equity", fmtPct(dcf.wacc.wEquity, 1)],
                ["Weight: debt", fmtPct(dcf.wacc.wDebt, 1)],
              ].map(([k, v]) => (
                <tr key={k as string} className="border-b border-border/40">
                  <td className="p-2 text-muted-foreground">{k}</td>
                  <td className="p-2 text-right font-medium">{v}</td>
                </tr>
              ))}
              <tr className="bg-primary/10">
                <td className="p-2 font-bold">WACC</td>
                <td className="p-2 text-right font-bold text-primary text-base">{fmtPct(dcf.wacc.wacc, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Block>

      {/* BLOCK 3 — Projections */}
      <Block title="3 · 5-Year Projections (Bear / Base / Bull)">
        {(["bear", "base", "bull"] as const).map((sc) => (
          <div key={sc} className="mb-5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              {sc === "bear" ? "🐻 Bear Case" : sc === "base" ? "⚖️ Base Case" : "🐂 Bull Case"}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left p-2">Line</th>
                    {dcf.projection[sc].map((p) => <th key={p.year} className="text-right p-2">Y{p.year}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Revenue growth", "revenueGrowth", (v: number) => fmtPct(v, 1)],
                    ["Revenue", "revenue", (v: number) => fmtMn(v, sym)],
                    ["EBITDA margin", "ebitdaMargin", (v: number) => fmtPct(v, 1)],
                    ["EBITDA", "ebitda", (v: number) => fmtMn(v, sym)],
                    ["EBIT", "ebit", (v: number) => fmtMn(v, sym)],
                    ["NOPAT", "nopat", (v: number) => fmtMn(v, sym)],
                    ["CapEx", "capex", (v: number) => fmtMn(v, sym)],
                    ["Δ Working Capital", "changeWC", (v: number) => fmtMn(v, sym)],
                    ["Free Cash Flow", "fcf", (v: number) => fmtMn(v, sym)],
                    ["Discount factor", "discountFactor", (v: number) => v.toFixed(3)],
                    ["PV of FCF", "pvFCF", (v: number) => fmtMn(v, sym)],
                  ] as const).map(([label, key, fmt]) => (
                    <tr key={key} className="border-b border-border/30">
                      <td className="p-2 text-muted-foreground">{label}</td>
                      {dcf.projection[sc].map((p) => (
                        <td key={p.year} className="p-2 text-right">{fmt((p as any)[key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Block>

      {/* BLOCK 4 — Terminal Value */}
      <Block title="4 · Terminal Value Analysis (Base Case)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <div className="font-semibold">Exit Multiple Method</div>
            <Row k="Terminal EBITDA (Y5)" v={fmtMn(dcf.terminalValue.terminalEBITDA, sym)} />
            <Row k="Exit multiple" v={fmtX(dcf.terminalValue.exitMultiple)} />
            <Row k="Terminal Value" v={fmtMn(dcf.terminalValue.tvMultiple, sym)} />
            <Row k="PV of Terminal Value" v={fmtMn(dcf.terminalValue.pvTvMultiple, sym)} bold />
          </div>
          <div className="space-y-2">
            <div className="font-semibold">Perpetuity Growth Method (Gordon)</div>
            <Row k="Terminal FCF (Y5)" v={fmtMn(dcf.terminalValue.terminalFCF, sym)} />
            <Row k="Terminal growth (g)" v={fmtPct(dcf.terminalValue.terminalGrowth, 2)} />
            <Row k="Terminal Value" v={fmtMn(dcf.terminalValue.tvGGM, sym)} />
            <Row k="PV of Terminal Value" v={fmtMn(dcf.terminalValue.pvTvGGM, sym)} bold />
          </div>
        </div>
        <div className="mt-4 p-3 rounded bg-muted/30 text-xs space-y-1">
          <Row k="Blended PV of Terminal Value" v={fmtMn(dcf.terminalValue.pvTermBlended, sym)} bold />
          <Row k="Terminal value as % of EV (Multiple)" v={fmtPct(dcf.terminalValue.pctMultiple, 1)} />
          <Row k="Terminal value as % of EV (Perpetuity)" v={fmtPct(dcf.terminalValue.pctGGM, 1)} />
        </div>
      </Block>

      {/* BLOCK 5 — Valuation Bridge + Football Field */}
      <Block title="5 · Valuation Bridge & Football Field">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="text-xs space-y-1">
            <Row k="Sum of PV (Y1-Y5 FCF)" v={fmtMn(dcf.bridge.sumPV, sym)} />
            <Row k="(+) PV of Terminal Value" v={fmtMn(dcf.bridge.pvTerminal, sym)} />
            <Row k="= Enterprise Value" v={fmtMn(dcf.bridge.ev, sym)} bold />
            <Row k="(−) Net Debt" v={fmtMn(dcf.bridge.netDebt, sym)} />
            <Row k="= Equity Value" v={fmtMn(dcf.bridge.equity, sym)} bold />
            <Row k="(÷) Diluted Shares" v={(dcf.bridge.diluted / 1e6).toFixed(1) + "M"} />
            <div className="mt-3 p-3 rounded bg-primary/10 border border-primary/30">
              <Row k="Implied Price (Base)" v={fmtMoney(dcf.bridge.impliedPrice, sym, 2)} bold />
              <Row k="Current Price" v={fmtMoney(dcf.bridge.currentPrice, sym, 2)} />
              <Row k="Premium / (Discount)"
                v={<span className={dcf.bridge.premiumPct >= 0 ? "text-success font-bold" : "text-danger font-bold"}>
                  {dcf.bridge.premiumPct >= 0 ? "+" : ""}{fmtPct(dcf.bridge.premiumPct, 1)}
                </span>} />
            </div>
          </div>

          {/* Football Field */}
          <FootballField data={dcf.footballField} current={cur} sym={sym} />
        </div>
      </Block>

      {/* BLOCK 6 — Sensitivity */}
      <Block title="6 · Sensitivity Tables (Implied Price)">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SensitivityTable
            title="WACC × Terminal Growth"
            rows={dcf.sensitivity.waccRange.map((w) => fmtPct(w, 2))}
            cols={dcf.sensitivity.tgrRange.map((g) => fmtPct(g, 1))}
            rowLabel="WACC"
            colLabel="g"
            data={dcf.sensitivity.sensA}
            current={cur}
            sym={sym}
          />
          <SensitivityTable
            title="Revenue Growth × EBITDA Margin"
            rows={dcf.sensitivity.growthLabels}
            cols={dcf.sensitivity.marginOffsets.map((m) => `${m >= 0 ? "+" : ""}${(m * 100).toFixed(0)}%`)}
            rowLabel="Growth"
            colLabel="Margin"
            data={dcf.sensitivity.sensB}
            current={cur}
            sym={sym}
          />
        </div>
      </Block>

      {/* BLOCK 7 — AI Memo */}
      <Block title="7 · Investment Memo — Morgan Stanley Framework (AI)">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">
            Generated by Claude Sonnet 4.5 from the model output above. Click to (re)generate.
          </p>
          <Button size="sm" variant="outline" onClick={() => memoMut.mutate(dcf)} disabled={memoMut.isPending}>
            {memoMut.isPending ? "Generating…" : memoMut.data?.memo ? "Regenerate Memo" : "Generate Memo"}
          </Button>
        </div>
        {memoMut.data?.error && <p className="text-xs text-danger">{memoMut.data.error}</p>}
        {memoMut.data?.memo && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm whitespace-pre-wrap font-serif leading-relaxed bg-muted/20 p-4 rounded border border-border">
            {memoMut.data.memo}
          </div>
        )}
      </Block>

      {/* BLOCK 8 — Assumptions Log */}
      <Block title="8 · Assumptions & Sources (Editable)">
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left p-2">Assumption</th>
                <th className="text-right p-2">Value</th>
                <th className="text-left p-2">Source</th>
                <th className="text-right p-2">Override</th>
              </tr>
            </thead>
            <tbody>
              {dcf.assumptions.map((a, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className="p-2">{a.label}</td>
                  <td className="p-2 text-right font-medium">{a.value}</td>
                  <td className="p-2 text-[10px] text-muted-foreground">{a.source}</td>
                  <td className="p-2 text-right">
                    {a.editable && a.key ? (
                      <input
                        type="number"
                        step="0.01"
                        defaultValue={
                          a.key === "terminalGrowthRate" ? (((overrides.terminalGrowthRate ?? 0.025) * 100).toFixed(2)) :
                          a.key === "exitMultiple" ? ((overrides.exitMultiple ?? parseFloat(a.value)).toFixed(1)) :
                          a.key === "capexPctRevenue" ? (((overrides.capexPctRevenue ?? 0) * 100 || parseFloat(a.value)).toFixed(2)) :
                          a.key === "bearMultiplier" ? ((overrides.bearMultiplier ?? 0.65).toFixed(2)) :
                          a.key === "bullMultiplier" ? ((overrides.bullMultiplier ?? 1.40).toFixed(2)) : ""
                        }
                        onChange={(e) => handleOverride(a.key as keyof DCFOverrides, e.target.value)}
                        className="w-20 bg-background border border-border rounded px-2 py-0.5 text-right text-xs"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">locked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dcf.dataQuality.proxies.length > 0 && (
          <div className="mt-4 p-3 rounded border border-warning/30 bg-warning/5">
            <div className="text-xs font-semibold text-warning mb-2">⚠️ Data quality notes ({dcf.dataQuality.proxies.length} proxies used):</div>
            <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-5">
              {dcf.dataQuality.proxies.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        )}
      </Block>
    </section>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-3 border-l-4 border-primary pl-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? "font-bold" : ""}`}>
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

function FootballField({ data, current, sym }: { data: { label: string; low: number; high: number; mid: number }[]; current: number; sym: string }) {
  const allVals = data.flatMap((d) => [d.low, d.high]).concat(current);
  const min = Math.min(...allVals) * 0.95;
  const max = Math.max(...allVals) * 1.05;
  const range = max - min || 1;
  const pos = (v: number) => `${((v - min) / range) * 100}%`;

  return (
    <div>
      <div className="text-xs font-semibold mb-2">Football Field — Implied Price Ranges</div>
      <div className="relative space-y-3 pt-2 pb-6">
        {data.map((d, i) => (
          <div key={i} className="relative h-8">
            <div className="absolute left-0 -top-3 text-[10px] text-muted-foreground">{d.label}</div>
            <div className="absolute top-3 h-2 bg-muted/40 rounded" style={{ left: 0, right: 0 }} />
            <div
              className="absolute top-2 h-4 bg-primary/40 border border-primary rounded"
              style={{ left: pos(d.low), width: `calc(${pos(d.high)} - ${pos(d.low)})` }}
              title={`${fmtMoney(d.low, sym, 2)} – ${fmtMoney(d.high, sym, 2)} (mid ${fmtMoney(d.mid, sym, 2)})`}
            />
            <div className="absolute top-1 w-0.5 h-6 bg-primary" style={{ left: pos(d.mid) }} />
            <div className="absolute -bottom-4 text-[9px] text-muted-foreground" style={{ left: pos(d.low) }}>{fmtMoney(d.low, sym, 0)}</div>
            <div className="absolute -bottom-4 text-[9px] text-muted-foreground" style={{ left: pos(d.high) }}>{fmtMoney(d.high, sym, 0)}</div>
          </div>
        ))}
        {/* Current price line */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-warning" style={{ left: pos(current) }}>
          <div className="absolute -top-2 -translate-x-1/2 text-[10px] font-bold text-warning whitespace-nowrap bg-background px-1 rounded">
            Current: {fmtMoney(current, sym, 2)}
          </div>
        </div>
      </div>
    </div>
  );
}

function SensitivityTable({ title, rows, cols, rowLabel, colLabel, data, current, sym }: {
  title: string; rows: string[]; cols: string[]; rowLabel: string; colLabel: string;
  data: number[][]; current: number; sym: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold mb-2">{title}</div>
      <table className="w-full text-[10px] tabular-nums border border-border">
        <thead>
          <tr className="bg-muted/40">
            <th className="p-1 border border-border text-muted-foreground">{rowLabel} ↓ / {colLabel} →</th>
            {cols.map((c) => <th key={c} className="p-1 border border-border">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td className="p-1 border border-border text-muted-foreground font-medium">{rows[i]}</td>
              {row.map((v, j) => (
                <td key={j} className={`p-1 border border-border text-center ${priceCellTone(v, current)}`}>
                  {fmtMoney(v, sym, 2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}