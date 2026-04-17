import { cn } from "@/lib/utils";

export function Gauge({ value, size = 200 }: { value: number; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const radius = (size - 24) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (v / 100) * circ;
  const tone = v >= 65 ? "var(--color-success)" : v >= 35 ? "var(--color-warning)" : "var(--color-danger)";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-muted)" strokeWidth={12} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={tone} strokeWidth={12} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.4s" }}
        />
      </svg>
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center")}>
        <div className="text-5xl font-bold tabular-nums" style={{ color: tone }}>{v}</div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Score / 100</div>
      </div>
    </div>
  );
}
