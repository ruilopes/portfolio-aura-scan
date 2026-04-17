import { fmtPct, fmtDate } from "@/lib/format";

interface Holder {
  organization: string | null;
  pctHeld: number | null;
  reportDate: string | null;
  value: number | null;
}
interface InsiderTx {
  filerName: string | null;
  filerRelation: string | null;
  transactionText: string | null;
  shares: number | null;
  value: number | null;
  startDate: string | null;
}

const fmtMoney = (v: number | null) => {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

export function OwnershipPanel({
  topHolders,
  heldPctInst,
  heldPctInsiders,
  recentInsiderTx,
}: {
  topHolders: Holder[];
  heldPctInst: number | null;
  heldPctInsiders: number | null;
  recentInsiderTx: InsiderTx[];
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="glass-card p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-semibold">Ownership</h3>
          <div className="text-xs text-muted-foreground flex gap-3">
            <span>Inst: <span className="text-foreground font-medium">{fmtPct(heldPctInst)}</span></span>
            <span>Insider: <span className="text-foreground font-medium">{fmtPct(heldPctInsiders)}</span></span>
          </div>
        </div>
        {topHolders.length ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2">Top institutional holders</th>
                <th className="text-right">% Held</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {topHolders.map((h, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className="py-2 truncate max-w-[200px]">{h.organization || "—"}</td>
                  <td className="text-right tabular-nums">{fmtPct(h.pctHeld)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{fmtMoney(h.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground italic">No institutional ownership data.</p>
        )}
      </div>

      <div className="glass-card p-5">
        <h3 className="font-semibold mb-3">Recent insider transactions</h3>
        {recentInsiderTx.length ? (
          <ul className="space-y-2.5 text-sm">
            {recentInsiderTx.map((t, i) => {
              const isBuy = (t.transactionText || "").toLowerCase().includes("buy") ||
                            (t.transactionText || "").toLowerCase().includes("purchase");
              return (
                <li key={i} className="flex items-start justify-between gap-3 border-b border-border/40 pb-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.filerName || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.filerRelation || "—"} · {fmtDate(t.startDate)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xs font-medium ${isBuy ? "text-success" : "text-danger"}`}>
                      {t.transactionText || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {t.shares != null ? `${t.shares.toLocaleString()} sh` : "—"}
                      {t.value != null && ` · ${fmtMoney(t.value)}`}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground italic">No recent insider transactions.</p>
        )}
      </div>
    </section>
  );
}
