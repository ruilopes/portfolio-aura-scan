import { fmtMoneyCcy, fmtPctRaw } from "@/lib/format";

type PnlYear = {
  fiscalYear: number | null;
  periodEnd: string | null;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  epsDiluted: number | null;
};

export type PnlHistory = {
  source: string;
  years: PnlYear[];
  quarters: PnlYear[];
  growth2Y: number | null;
  growthYoY: number | null;
  growthQoQ: number | null;
  netIncomeYoY: number | null;
};

const tone = (g: number | null) => {
  if (g == null) return "text-muted-foreground";
  if (g > 0.1) return "text-success";
  if (g >= 0) return "text-warning";
  return "text-danger";
};
const dot = (g: number | null) => (g == null ? "⚪" : g > 0.1 ? "🟢" : g >= 0 ? "🟡" : "🔴");

const fyLabel = (y: PnlYear): string => {
  if (y.fiscalYear != null) return `FY${y.fiscalYear}`;
  if (y.periodEnd) {
    const d = new Date(y.periodEnd);
    if (!isNaN(d.getTime())) return `FY${d.getUTCFullYear()}`;
  }
  return "FY—";
};

const pct = (n: number | null, denom: number | null) =>
  n == null || denom == null || denom === 0 ? null : n / denom;

function SourceTag({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {source} ✓
    </span>
  );
}

export function RevenueCard({ history, currencySymbol }: { history: PnlHistory; currencySymbol: string }) {
  const years = history.years.slice(0, 3);
  const insufficient = years.length < 2;
  const maxRev = Math.max(...years.map((y) => y.revenue ?? 0), 1);

  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-base">Revenue</h3>
          <div className="mt-1 text-xs text-muted-foreground">Last {years.length || 0}-year trend</div>
        </div>
        <SourceTag source={history.source} />
      </div>

      {years.length === 0 ? (
        <div className="text-sm text-muted-foreground">—</div>
      ) : (
        <div className="space-y-2">
          {years.map((y, i) => {
            const prior = years[i + 1];
            const yoy = prior ? pct((y.revenue ?? 0) - (prior.revenue ?? 0), prior.revenue) : null;
            const widthPct = y.revenue != null ? Math.max(8, (y.revenue / maxRev) * 100) : 0;
            const barColor =
              yoy == null ? "bg-muted-foreground/40" : yoy >= 0 ? "bg-success/70" : "bg-danger/70";
            return (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-14 text-muted-foreground tabular-nums">{fyLabel(y)}</span>
                <span className="w-20 font-medium tabular-nums">{fmtMoneyCcy(y.revenue, currencySymbol)}</span>
                <div className="flex-1 h-3 rounded-sm bg-muted overflow-hidden">
                  <div className={`h-full ${barColor} transition-all`} style={{ width: `${widthPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {insufficient && years.length > 0 && (
        <div className="text-[11px] text-warning">Insufficient history for 2Y comparison</div>
      )}

      <div className="border-t border-border pt-3 space-y-1.5 text-sm">
        <Row label="2Y Growth" value={history.growth2Y} />
        <Row label="YoY (latest)" value={history.growthYoY} />
        <Row label="QoQ (latest Q)" value={history.growthQoQ} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${tone(value)}`}>
        {value == null ? "—" : `${value >= 0 ? "+" : ""}${fmtPctRaw(value * 100)}`} {dot(value)}
      </span>
    </div>
  );
}

export function PnLCard({ history, currencySymbol }: { history: PnlHistory; currencySymbol: string }) {
  const [fy0, fy1] = history.years;
  const has = !!fy0;
  const ni0 = fy0?.netIncome ?? null;
  const ni1 = fy1?.netIncome ?? null;
  const flippedToProfit = ni0 != null && ni1 != null && ni1 < 0 && ni0 > 0;
  const flippedToLoss = ni0 != null && ni1 != null && ni1 > 0 && ni0 < 0;

  const cellTone = (a: number | null, b: number | null): string => {
    if (a == null || b == null) return "";
    const d = pct(a - b, b);
    if (d == null) return "";
    if (Math.abs(d) < 0.02) return "";
    return d > 0 ? "text-success" : "text-danger";
  };

  const fmtMoney = (v: number | null) => {
    if (v == null) return "—";
    if (v < 0) return `(${fmtMoneyCcy(Math.abs(v), currencySymbol)})`;
    return fmtMoneyCcy(v, currencySymbol);
  };

  const marginCell = (n: number | null, d: number | null, prevN: number | null, prevD: number | null) => {
    const m = pct(n, d);
    const pm = pct(prevN, prevD);
    let arrow = "";
    let cls = "";
    if (m != null && pm != null) {
      if (m - pm > 0.002) { arrow = " ▲"; cls = "text-success"; }
      else if (m - pm < -0.002) { arrow = " ▼"; cls = "text-danger"; }
    }
    return { text: m == null ? "—" : `${(m * 100).toFixed(1)}%${arrow}`, cls };
  };

  const m0Gross = marginCell(fy0?.grossProfit ?? null, fy0?.revenue ?? null, fy1?.grossProfit ?? null, fy1?.revenue ?? null);
  const m1Gross = marginCell(fy1?.grossProfit ?? null, fy1?.revenue ?? null, null, null);
  const m0Op = marginCell(fy0?.operatingIncome ?? null, fy0?.revenue ?? null, fy1?.operatingIncome ?? null, fy1?.revenue ?? null);
  const m1Op = marginCell(fy1?.operatingIncome ?? null, fy1?.revenue ?? null, null, null);
  const m0Net = marginCell(fy0?.netIncome ?? null, fy0?.revenue ?? null, fy1?.netIncome ?? null, fy1?.revenue ?? null);
  const m1Net = marginCell(fy1?.netIncome ?? null, fy1?.revenue ?? null, null, null);

  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-base">Profit &amp; Loss</h3>
          <div className="mt-1 text-xs text-muted-foreground">Income statement summary</div>
        </div>
        <SourceTag source={history.source} />
      </div>

      {!has ? (
        <div className="text-sm text-muted-foreground">—</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="text-left font-normal pb-2"></th>
              <th className="text-right font-medium pb-2">{fyLabel(fy0)}</th>
              <th className="text-right font-medium pb-2">{fy1 ? fyLabel(fy1) : "—"}</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1 tabular-nums">
            <tr>
              <td className="text-muted-foreground">Revenue</td>
              <td className={`text-right ${cellTone(fy0.revenue, fy1?.revenue ?? null)}`}>{fmtMoney(fy0.revenue)}</td>
              <td className="text-right">{fmtMoney(fy1?.revenue ?? null)}</td>
            </tr>
            <tr>
              <td className="text-muted-foreground">Gross Profit</td>
              <td className={`text-right ${cellTone(fy0.grossProfit, fy1?.grossProfit ?? null)}`}>{fmtMoney(fy0.grossProfit)}</td>
              <td className="text-right">{fmtMoney(fy1?.grossProfit ?? null)}</td>
            </tr>
            <tr>
              <td className="text-muted-foreground pl-3 text-xs">Gross Margin</td>
              <td className={`text-right text-xs ${m0Gross.cls}`}>{m0Gross.text}</td>
              <td className="text-right text-xs">{m1Gross.text}</td>
            </tr>
            <tr>
              <td className="text-muted-foreground">Operating Income</td>
              <td className={`text-right ${cellTone(fy0.operatingIncome, fy1?.operatingIncome ?? null)}`}>{fmtMoney(fy0.operatingIncome)}</td>
              <td className="text-right">{fmtMoney(fy1?.operatingIncome ?? null)}</td>
            </tr>
            <tr>
              <td className="text-muted-foreground pl-3 text-xs">Op. Margin</td>
              <td className={`text-right text-xs ${m0Op.cls}`}>{m0Op.text}</td>
              <td className="text-right text-xs">{m1Op.text}</td>
            </tr>
            <tr>
              <td className="text-muted-foreground">Net Income</td>
              <td className={`text-right ${(fy0.netIncome ?? 0) < 0 ? "text-danger" : cellTone(fy0.netIncome, fy1?.netIncome ?? null)}`}>
                {fmtMoney(fy0.netIncome)}
              </td>
              <td className={`text-right ${(fy1?.netIncome ?? 0) < 0 ? "text-danger" : ""}`}>
                {fmtMoney(fy1?.netIncome ?? null)}
              </td>
            </tr>
            <tr>
              <td className="text-muted-foreground pl-3 text-xs">Net Margin</td>
              <td className={`text-right text-xs ${m0Net.cls}`}>{m0Net.text}</td>
              <td className="text-right text-xs">{m1Net.text}</td>
            </tr>
            <tr>
              <td className="text-muted-foreground">EPS (diluted)</td>
              <td className="text-right">{fy0.epsDiluted == null ? "—" : `${currencySymbol}${fy0.epsDiluted.toFixed(2)}`}</td>
              <td className="text-right">{fy1?.epsDiluted == null ? "—" : `${currencySymbol}${fy1.epsDiluted.toFixed(2)}`}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="border-t border-border pt-3 text-sm flex items-center justify-between">
        <span className="text-muted-foreground">Net Income trend</span>
        {flippedToProfit ? (
          <span className="text-success font-medium">🟢 Returned to profitability</span>
        ) : flippedToLoss ? (
          <span className="text-danger font-medium">🔴 Turned to loss</span>
        ) : (
          <span className={`tabular-nums font-medium ${tone(history.netIncomeYoY)}`}>
            {history.netIncomeYoY == null ? "—" : `${history.netIncomeYoY >= 0 ? "+" : ""}${fmtPctRaw(history.netIncomeYoY * 100)} YoY`} {dot(history.netIncomeYoY)}
          </span>
        )}
      </div>

      {history.years.length === 1 && (
        <div className="text-[11px] text-warning">Insufficient history for 2Y comparison</div>
      )}
    </div>
  );
}