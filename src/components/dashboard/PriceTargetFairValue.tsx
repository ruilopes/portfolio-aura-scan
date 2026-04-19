import { fmtPrice, fmtPct, fmtPctRaw } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FairValueModel {
  name: string;
  value: number | null;
  vsCurrent: number | null; // decimal, e.g. 0.087 = +8.7%
  note?: string | null;
  tooltip?: string;
}

export interface PriceTargetData {
  current: number | null;
  consensus: number | null;
  high: number | null;
  low: number | null;
  upside: number | null; // decimal
  totalAnalysts: number;
  source: string | null;
  breakdown?: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
}

export interface FairValueData {
  models: FairValueModel[];
  average: number | null;
  averageVsCurrent: number | null;
}

interface Props {
  current: number | null;
  priceTarget: PriceTargetData;
  fairValue: FairValueData;
}

const upsideTone = (v: number | null) => {
  if (v == null) return { tone: "text-muted-foreground", emoji: "", label: "—" };
  if (v >= 0.20) return { tone: "text-success", emoji: "🟢", label: "Strong upside" };
  if (v >= 0.10) return { tone: "text-success", emoji: "🟢", label: "Moderate upside" };
  if (v >= 0) return { tone: "text-warning", emoji: "🟡", label: "Limited upside" };
  return { tone: "text-danger", emoji: "🔴", label: "Overvalued vs consensus" };
};

const fairTone = (v: number | null) => {
  if (v == null) return { tone: "text-muted-foreground", emoji: "—", label: "N/A" };
  if (v > 0.15) return { tone: "text-success", emoji: "🟢", label: "Strong upside" };
  if (v > 0.05) return { tone: "text-success", emoji: "🟢", label: "Upside" };
  if (v > -0.05) return { tone: "text-warning", emoji: "🟡", label: "Fair" };
  if (v > -0.15) return { tone: "text-danger", emoji: "🔴", label: "Expensive" };
  return { tone: "text-danger", emoji: "🔴", label: "Significantly overvalued" };
};

function TargetRangeBar({ low, high, current, consensus }: { low: number | null; high: number | null; current: number | null; consensus: number | null }) {
  if (low == null || high == null || current == null || high <= low) {
    return <div className="text-xs text-muted-foreground italic">Range data unavailable</div>;
  }
  const span = high - low;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100));
  const curPct = pct(current);
  const tgtPct = consensus != null ? pct(consensus) : null;
  const isUpside = consensus != null && consensus > current;
  return (
    <div className="space-y-1.5">
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className={cn(
            "absolute top-0 h-2 rounded-full opacity-30",
            isUpside ? "bg-success" : "bg-danger",
          )}
          style={{
            left: `${Math.min(curPct, tgtPct ?? curPct)}%`,
            width: `${Math.abs((tgtPct ?? curPct) - curPct)}%`,
          }}
        />
        {/* Current marker */}
        <div
          className="absolute -top-1 w-3 h-4 rounded-sm bg-foreground border border-background"
          style={{ left: `calc(${curPct}% - 6px)` }}
          title={`Current: ${fmtPrice(current)}`}
        />
        {/* Consensus marker */}
        {tgtPct != null && (
          <div
            className={cn(
              "absolute -top-1 w-3 h-4 rounded-full border-2 border-background",
              isUpside ? "bg-success" : "bg-danger",
            )}
            style={{ left: `calc(${tgtPct}% - 6px)` }}
            title={`Target: ${fmtPrice(consensus)}`}
          />
        )}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{fmtPrice(low)}</span>
        <span>{fmtPrice(high)}</span>
      </div>
      <div className="flex gap-3 text-[11px] tabular-nums">
        <span><span className="inline-block w-2 h-2 bg-foreground mr-1 align-middle" />Current {fmtPrice(current)}</span>
        {consensus != null && (
          <span><span className={cn("inline-block w-2 h-2 rounded-full mr-1 align-middle", isUpside ? "bg-success" : "bg-danger")} />Target {fmtPrice(consensus)}</span>
        )}
      </div>
    </div>
  );
}

function AnalystBreakdown({ b }: { b: NonNullable<PriceTargetData["breakdown"]> }) {
  const max = Math.max(b.strongBuy, b.buy, b.hold, b.sell, b.strongSell, 1);
  const rows: { k: string; v: number; tone: string }[] = [
    { k: "Strong Buy", v: b.strongBuy, tone: "bg-success" },
    { k: "Buy", v: b.buy, tone: "bg-success/70" },
    { k: "Hold", v: b.hold, tone: "bg-warning" },
    { k: "Sell", v: b.sell, tone: "bg-danger/70" },
    { k: "Strong Sell", v: b.strongSell, tone: "bg-danger" },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-2 text-xs">
          <div className="w-20 text-muted-foreground">{r.k}</div>
          <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
            <div className={cn("h-full rounded", r.tone)} style={{ width: `${(r.v / max) * 100}%` }} />
          </div>
          <div className="w-6 text-right tabular-nums">{r.v}</div>
        </div>
      ))}
    </div>
  );
}

export function PriceTargetFairValue({ current, priceTarget, fairValue }: Props) {
  const ups = upsideTone(priceTarget.upside);
  const avgTone = fairTone(fairValue.averageVsCurrent);

  return (
    <section>
      <h2 className="text-xl font-bold mb-4">Price Target &amp; Fair Value</h2>
      <div className="grid grid-cols-1 lg:grid-cols-[45fr_55fr] gap-5">
        {/* LEFT — Price Target */}
        <div className="glass-card p-5 space-y-4">
          <div>
            <h3 className="font-semibold">Analyst Price Target</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Consensus from analyst recommendations</p>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Current price</span><span className="font-medium tabular-nums">{fmtPrice(current)}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Consensus target</span>
              <span className="font-medium tabular-nums">
                {fmtPrice(priceTarget.consensus)}{" "}
                {priceTarget.upside != null && (
                  <span className={ups.tone}>{priceTarget.upside >= 0 ? "↑" : "↓"} {priceTarget.upside >= 0 ? "+" : ""}{fmtPctRaw(priceTarget.upside * 100)}</span>
                )}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">High target</span><span className="font-medium tabular-nums">{fmtPrice(priceTarget.high)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Low target</span><span className="font-medium tabular-nums">{fmtPrice(priceTarget.low)}</span></div>
          </div>

          <div className="pt-2">
            <TargetRangeBar low={priceTarget.low} high={priceTarget.high} current={current} consensus={priceTarget.consensus} />
          </div>

          {priceTarget.breakdown && (priceTarget.breakdown.strongBuy + priceTarget.breakdown.buy + priceTarget.breakdown.hold + priceTarget.breakdown.sell + priceTarget.breakdown.strongSell) > 0 ? (
            <div className="pt-2">
              <div className="text-xs font-semibold text-muted-foreground mb-2">Analyst breakdown</div>
              <AnalystBreakdown b={priceTarget.breakdown} />
            </div>
          ) : null}

          <div className="border-t border-border/50 pt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Upside to target</span>
            <span className={cn("font-semibold tabular-nums", ups.tone)}>
              {priceTarget.upside != null ? `${priceTarget.upside >= 0 ? "+" : ""}${fmtPctRaw(priceTarget.upside * 100)}` : "—"} {ups.emoji} {ups.label}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Source: {priceTarget.source || "—"}
            {priceTarget.totalAnalysts > 0 && ` · ${priceTarget.totalAnalysts} analyst${priceTarget.totalAnalysts === 1 ? "" : "s"}`}
          </div>
        </div>

        {/* RIGHT — Fair Value */}
        <div className="glass-card p-5 space-y-4">
          <div>
            <h3 className="font-semibold">Fair Value Models</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Quantitative valuations from financial data</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fairValue.models.map((m) => {
              const t = fairTone(m.vsCurrent);
              return (
                <div key={m.name} className="rounded-lg border border-border/50 bg-background/40 p-3" title={m.tooltip}>
                  <div className="text-xs font-semibold text-muted-foreground">{m.name}</div>
                  <div className="text-lg font-bold tabular-nums mt-1">
                    {m.value != null ? fmtPrice(m.value) : <span className="text-sm text-muted-foreground">N/A</span>}
                  </div>
                  {m.vsCurrent != null ? (
                    <div className={cn("text-xs tabular-nums mt-0.5", t.tone)}>
                      {m.vsCurrent >= 0 ? "+" : ""}{fmtPctRaw(m.vsCurrent * 100)} {t.emoji}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-0.5">{m.note || "Not applicable"}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary table */}
          <div className="border-t border-border/50 pt-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2">Summary</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/50">
                    <th className="text-left font-medium py-1.5">Model</th>
                    <th className="text-right font-medium py-1.5">Fair Value</th>
                    <th className="text-right font-medium py-1.5">vs Current</th>
                    <th className="text-right font-medium py-1.5">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {fairValue.models.map((m) => {
                    const t = fairTone(m.vsCurrent);
                    return (
                      <tr key={m.name} className="border-b border-border/30">
                        <td className="py-1.5">{m.name}</td>
                        <td className="text-right tabular-nums">{m.value != null ? fmtPrice(m.value) : "N/A"}</td>
                        <td className={cn("text-right tabular-nums", m.vsCurrent != null ? t.tone : "text-muted-foreground")}>
                          {m.vsCurrent != null ? `${m.vsCurrent >= 0 ? "+" : ""}${fmtPctRaw(m.vsCurrent * 100)}` : "—"}
                        </td>
                        <td className={cn("text-right", m.vsCurrent != null ? t.tone : "text-muted-foreground")}>
                          {m.vsCurrent != null ? `${t.emoji} ${t.label}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold">
                    <td className="py-2">Average Fair Value</td>
                    <td className="text-right tabular-nums">{fairValue.average != null ? fmtPrice(fairValue.average) : "N/A"}</td>
                    <td className={cn("text-right tabular-nums", fairValue.averageVsCurrent != null ? avgTone.tone : "text-muted-foreground")}>
                      {fairValue.averageVsCurrent != null ? `${fairValue.averageVsCurrent >= 0 ? "+" : ""}${fmtPctRaw(fairValue.averageVsCurrent * 100)}` : "—"}
                    </td>
                    <td className={cn("text-right", fairValue.averageVsCurrent != null ? avgTone.tone : "text-muted-foreground")}>
                      {fairValue.averageVsCurrent != null ? `${avgTone.emoji} ${avgTone.label}` : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        Fair value estimates are calculated from publicly available financial data using standard valuation models.
        They are mathematical approximations and not investment advice. Model assumptions (growth rates, discount rates,
        sector multiples) may differ from actual market conditions.
      </p>
    </section>
  );
}
