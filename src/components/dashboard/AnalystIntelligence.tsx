import { fmtDate, fmtPrice, fmtPct } from "@/lib/format";

interface Rating { date: string; buy: number; hold: number; sell: number }
interface Filing { form: string; filingDate: string; accession: string; primaryDoc: string }

interface Props {
  ratings: Rating[];
  targetPrice: number | null;
  upside: number | null;
  consensusLabel: string | null;
  totalAnalysts: number;
  nextEarnings: string | null;
  nextEPSEst: number | null;
  filings: Filing[];
  cik: string | null;
}

export function AnalystIntelligence(p: Props) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="glass-card p-5 lg:col-span-2">
        <h3 className="font-semibold mb-4">Analyst Ratings (recent)</h3>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div>
            <div className="text-xs text-muted-foreground">Consensus</div>
            <div className="font-semibold text-success">{p.consensusLabel || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Analysts</div>
            <div className="font-semibold">{p.totalAnalysts || "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Price Target</div>
            <div className="font-semibold">{fmtPrice(p.targetPrice)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Upside</div>
            <div className={`font-semibold ${p.upside != null && p.upside >= 0 ? "text-success" : "text-danger"}`}>
              {fmtPct(p.upside)}
            </div>
          </div>
        </div>
        {p.ratings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2">Date</th>
                  <th className="text-right">Buy</th>
                  <th className="text-right">Hold</th>
                  <th className="text-right">Sell</th>
                </tr>
              </thead>
              <tbody>
                {p.ratings.map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-2">{fmtDate(r.date)}</td>
                    <td className="text-right text-success font-medium">{r.buy}</td>
                    <td className="text-right text-muted-foreground">{r.hold}</td>
                    <td className="text-right text-danger font-medium">{r.sell}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No analyst data available.</p>
        )}
      </div>

      <div className="space-y-5">
        <div className="glass-card p-5">
          <h3 className="font-semibold mb-3">Next Earnings</h3>
          <div className="text-2xl font-bold">{fmtDate(p.nextEarnings)}</div>
          {p.nextEPSEst != null && (
            <div className="text-sm text-muted-foreground mt-1">
              Expected EPS: <span className="text-foreground font-medium">${p.nextEPSEst.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
