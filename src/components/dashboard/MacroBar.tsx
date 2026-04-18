import { fmtNum } from "@/lib/format";

interface Props {
  fedFunds: number | null;
  treas10y: number | null;
  treas2y: number | null;
  yieldCurve: number | null;
  cpi: number | null;
  unemployment: number | null;
  vix: number | null;
  dxy: number | null;
  sp500: number | null;
}

const Item = ({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) => (
  <div className="flex flex-col items-center min-w-0 px-2.5" title={hint}>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{label}</div>
    <div className={`text-sm font-semibold tabular-nums mt-0.5 ${tone || ""}`}>{value}</div>
  </div>
);

export function MacroBar(p: Props) {
  const inverted = p.yieldCurve != null && p.yieldCurve < 0;
  return (
    <div className="space-y-2 mt-4">
      {inverted && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2">
          ⚠️ Yield curve inverted ({p.yieldCurve!.toFixed(2)}%) — historically precedes recession.
        </div>
      )}
      <div className="glass-card px-2 py-3 overflow-x-auto">
        <div className="flex items-center justify-around gap-1 min-w-max">
          <Item label="Fed Funds" value={p.fedFunds != null ? `${p.fedFunds.toFixed(2)}%` : "—"} hint="FRED: FEDFUNDS" />
          <span className="w-px h-8 bg-border" />
          <Item label="US 10Y" value={p.treas10y != null ? `${p.treas10y.toFixed(2)}%` : "—"} hint="FRED: DGS10" />
          <span className="w-px h-8 bg-border" />
          <Item label="US 2Y" value={p.treas2y != null ? `${p.treas2y.toFixed(2)}%` : "—"} hint="FRED: DGS2" />
          <span className="w-px h-8 bg-border" />
          <Item
            label="10Y-2Y"
            value={p.yieldCurve != null ? `${p.yieldCurve.toFixed(2)}%` : "—"}
            tone={inverted ? "text-danger" : "text-success"}
            hint="FRED: T10Y2Y"
          />
          <span className="w-px h-8 bg-border" />
          <Item label="CPI" value={fmtNum(p.cpi, 1)} hint="FRED: CPIAUCSL" />
          <span className="w-px h-8 bg-border" />
          <Item label="Unemp" value={p.unemployment != null ? `${p.unemployment.toFixed(1)}%` : "—"} hint="FRED: UNRATE" />
          <span className="w-px h-8 bg-border" />
          <Item label="USD" value={fmtNum(p.dxy, 2)} hint="FRED: DTWEXBGS" />
          <span className="w-px h-8 bg-border" />
          <Item label="VIX" value={fmtNum(p.vix, 2)} tone={p.vix && p.vix > 20 ? "text-warning" : ""} hint="FRED: VIXCLS" />
          <span className="w-px h-8 bg-border" />
          <Item label="S&P 500" value={fmtNum(p.sp500, 0)} hint="FRED: SP500" />
        </div>
      </div>
    </div>
  );
}
