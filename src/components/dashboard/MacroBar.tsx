import { fmtNum } from "@/lib/format";

interface Props {
  fedFunds: number | null;
  treas10y: number | null;
  cpi: number | null;
  vix: number | null;
  dxy: number | null;
}

const Item = ({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) => (
  <div className="flex flex-col items-center min-w-0 px-3" title={hint}>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{label}</div>
    <div className={`text-sm font-semibold tabular-nums mt-0.5 ${tone || ""}`}>{value}</div>
  </div>
);

export function MacroBar(p: Props) {
  return (
    <div className="glass-card mt-4 px-3 py-3 overflow-x-auto">
      <div className="flex items-center justify-around gap-2 min-w-max">
        <Item
          label="Fed Funds"
          value={p.fedFunds != null ? `${p.fedFunds.toFixed(2)}%` : "—"}
          hint="Federal Funds Rate (FRED: FEDFUNDS)"
        />
        <span className="w-px h-8 bg-border" />
        <Item
          label="US 10Y"
          value={p.treas10y != null ? `${p.treas10y.toFixed(2)}%` : "—"}
          hint="10-Year Treasury Yield (FRED: DGS10)"
        />
        <span className="w-px h-8 bg-border" />
        <Item
          label="CPI Index"
          value={fmtNum(p.cpi, 1)}
          hint="Consumer Price Index, all urban (FRED: CPIAUCSL)"
        />
        <span className="w-px h-8 bg-border" />
        <Item
          label="USD Index"
          value={fmtNum(p.dxy, 2)}
          hint="Broad Trade-Weighted USD Index (FRED: DTWEXBGS)"
        />
        <span className="w-px h-8 bg-border" />
        <Item
          label="VIX"
          value={fmtNum(p.vix, 2)}
          tone={p.vix && p.vix > 20 ? "text-warning" : ""}
          hint="CBOE Volatility Index (FRED: VIXCLS)"
        />
      </div>
    </div>
  );
}
