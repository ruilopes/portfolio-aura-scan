import { ConfidenceBadge } from "./ConfidenceBadge";

interface CrossEntry {
  yahoo: number | null;
  sec: number | null;
  confidence: "high" | "medium" | "low";
}

interface Props {
  data: {
    revenue: CrossEntry;
    netIncome: CrossEntry;
    assets: CrossEntry;
    liabilities: CrossEntry;
    equity: CrossEntry;
  };
  hasSec: boolean;
}

const fmt = (v: number | null) => {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString()}`;
};

const ROWS: { key: keyof Props["data"]; label: string }[] = [
  { key: "revenue", label: "Revenue (FY)" },
  { key: "netIncome", label: "Net Income (FY)" },
  { key: "assets", label: "Total Assets" },
  { key: "liabilities", label: "Total Liabilities" },
  { key: "equity", label: "Stockholders' Equity" },
];

export function CrossCheckPanel({ data, hasSec }: Props) {
  return (
    <section className="glass-card p-5">
      <h3 className="font-semibold mb-1">Data Cross-Validation</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Yahoo Finance vs SEC EDGAR (us-gaap, latest 10-K). Confidence is{" "}
        <span className="text-success">High</span> when sources agree within 5%,{" "}
        <span className="text-warning">Medium</span> when only one returned data,{" "}
        <span className="text-danger">Low</span> when they diverge.
      </p>
      {!hasSec ? (
        <p className="text-sm text-muted-foreground italic">SEC EDGAR data unavailable for this ticker.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2">Metric</th>
                <th className="text-right">Yahoo Finance</th>
                <th className="text-right">SEC EDGAR</th>
                <th className="text-center w-20">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const e = data[row.key];
                return (
                  <tr key={row.key} className="border-b border-border/40">
                    <td className="py-2.5 font-medium">{row.label}</td>
                    <td className="text-right tabular-nums">{fmt(e.yahoo)}</td>
                    <td className="text-right tabular-nums">{fmt(e.sec)}</td>
                    <td className="text-center">
                      <ConfidenceBadge
                        confidence={e.confidence}
                        yahoo={e.yahoo}
                        sec={e.sec}
                        label={row.label}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
