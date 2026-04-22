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
  // Region-aware additions (optional for backward compat)
  policyRate?: number | null;
  policyRateLabel?: string;
  tenYearLabel?: string;
  eurUsd?: number | null;
  gbpUsd?: number | null;
  region?: "US" | "EUR" | "GBP";
}

const Item = ({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) => (
  <div className="flex flex-col items-center min-w-0 px-2.5" title={hint}>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{label}</div>
    <div className={`text-sm font-semibold tabular-nums mt-0.5 ${tone || ""}`}>{value}</div>
  </div>
);

export function MacroBar(p: Props) {
  const inverted = p.yieldCurve != null && p.yieldCurve < 0;
  const region = p.region ?? "US";
  const policyLabel = p.policyRateLabel ?? "Fed Funds";
  const policyVal = p.policyRate ?? p.fedFunds;
  const tenYLabel = p.tenYearLabel ?? "US 10Y";
  return (
    <div className="space-y-2 mt-4">
      {inverted && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2">
          ⚠️ Yield curve inverted ({p.yieldCurve!.toFixed(2)}%) — historically precedes recession.
        </div>
      )}
      <div className="glass-card px-2 py-3 overflow-x-auto">
        <div className="flex items-center justify-around gap-1 min-w-max">
          <Item label={policyLabel} value={policyVal != null ? `${policyVal.toFixed(2)}%` : "—"} hint="Local policy rate" />
          <span className="w-px h-8 bg-border" />
          <Item label={tenYLabel} value={p.treas10y != null ? `${p.treas10y.toFixed(2)}%` : "—"} hint="10Y benchmark yield (US Treasury proxy)" />
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
          {region === "EUR" && p.eurUsd != null ? (
            <Item label="EUR/USD" value={p.eurUsd.toFixed(4)} hint="FRED: DEXUSEU" />
          ) : region === "GBP" && p.gbpUsd != null ? (
            <Item label="GBP/USD" value={p.gbpUsd.toFixed(4)} hint="FRED: DEXUSUK" />
          ) : (
            <Item label="USD" value={fmtNum(p.dxy, 2)} hint="FRED: DTWEXBGS" />
          )}
          <span className="w-px h-8 bg-border" />
          <Item label="VIX" value={fmtNum(p.vix, 2)} tone={p.vix && p.vix > 20 ? "text-warning" : ""} hint="FRED: VIXCLS" />
          <span className="w-px h-8 bg-border" />
          <Item label="S&P 500" value={fmtNum(p.sp500, 0)} hint="FRED: SP500" />
        </div>
      </div>
    </div>
  );
}
