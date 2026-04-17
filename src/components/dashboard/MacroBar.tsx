import { fmtNum, fmtPctRaw } from "@/lib/format";

interface Props {
  fedFunds: number | null;
  treas10y: number | null;
  cpi: number | null;
  vix: number | null;
  dxy: number | null;
  spyPerf30: number | null;
}

const Item = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="flex flex-col items-center min-w-0 px-3">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{label}</div>
    <div className={`text-sm font-semibold tabular-nums mt-0.5 ${tone || ""}`}>{value}</div>
  </div>
);

export function MacroBar(p: Props) {
  return (
    <div className="glass-card mt-4 px-3 py-3 overflow-x-auto">
      <div className="flex items-center justify-around gap-2 min-w-max">
        <Item label="Fed Funds" value={p.fedFunds != null ? `${p.fedFunds.toFixed(2)}%` : "—"} />
        <span className="w-px h-8 bg-border" />
        <Item label="US 10Y" value={p.treas10y != null ? `${p.treas10y.toFixed(2)}%` : "—"} />
        <span className="w-px h-8 bg-border" />
        <Item label="DXY" value={fmtNum(p.dxy)} />
        <span className="w-px h-8 bg-border" />
        <Item label="SPY 30d" value={p.spyPerf30 != null ? fmtPctRaw(p.spyPerf30 * 100) : "—"}
          tone={p.spyPerf30 != null ? (p.spyPerf30 >= 0 ? "text-success" : "text-danger") : ""} />
        <span className="w-px h-8 bg-border" />
        <Item label="VIX" value={fmtNum(p.vix)} tone={p.vix && p.vix > 20 ? "text-warning" : ""} />
        <span className="w-px h-8 bg-border" />
        <Item label="CPI Idx" value={fmtNum(p.cpi, 1)} />
      </div>
    </div>
  );
}
