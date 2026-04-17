import { cn } from "@/lib/utils";

const ICONS: Record<string, string> = {
  Market: "📈", Sector: "🏭", Valuation: "💰", Financial: "💳",
  Earnings: "📊", Regulatory: "⚖️", Geopolitical: "🌍",
  Sentiment: "💬", Liquidity: "💧", ESG: "🌱",
};

const TONE: Record<string, string> = {
  high: "border-danger/40 bg-danger/10 text-danger",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-success/40 bg-success/10 text-success",
};

const BADGE: Record<string, string> = {
  high: "🔴 High",
  medium: "🟡 Medium",
  low: "🟢 Low",
};

export interface RiskFactor {
  category: string;
  label: string;
  description: string;
  severity: "high" | "medium" | "low";
  source: string;
}

export function RiskFactors({ risks }: { risks: RiskFactor[] }) {
  if (!risks.length) {
    return (
      <div className="text-sm text-muted-foreground italic p-6 text-center">
        ✅ No major risk factors triggered.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {risks.map((r, i) => (
        <div key={i} className={cn("rounded-lg border p-4 flex gap-3", TONE[r.severity])}>
          <div className="text-2xl shrink-0">{ICONS[r.category] || "⚠️"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold text-sm text-foreground">{r.label}</h4>
              <span className="text-[10px] font-medium whitespace-nowrap">{BADGE[r.severity]}</span>
            </div>
            <p className="text-xs text-foreground/80 mt-1 leading-relaxed">{r.description}</p>
            <p className="text-[10px] text-muted-foreground mt-2">Source: {r.source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
