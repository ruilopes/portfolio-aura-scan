import { cn } from "@/lib/utils";

export function CompletenessBar({ score, filled, total }: { score: number; filled: number; total: number }) {
  const tone =
    score >= 90 ? "success" : score >= 70 ? "primary" : score >= 50 ? "warning" : "danger";
  const label =
    score >= 90 ? "✅ Full analysis available"
    : score >= 70 ? "⚠️ Most data available — minor gaps"
    : score >= 50 ? "⚠️ Partial data — analysis may be limited"
    : "❌ Insufficient data — results unreliable";
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className={cn("text-sm font-semibold", `text-${tone}`)}>{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filled}/{total} indicators · {score}%
        </span>
      </div>
      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all", `bg-${tone}`)}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
