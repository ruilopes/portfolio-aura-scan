import { cn } from "@/lib/utils";

export function ScoreBar({ score }: { score: number }) {
  const v = Math.max(0, Math.min(10, score));
  const tone = v >= 7 ? "bg-success" : v >= 4 ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${v * 10}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{v.toFixed(1)}</span>
    </div>
  );
}

export function StatusDot({ score }: { score: number }) {
  const tone = score >= 7 ? "bg-success" : score >= 4 ? "bg-warning" : "bg-danger";
  return <span className={cn("inline-block w-2 h-2 rounded-full", tone)} />;
}
