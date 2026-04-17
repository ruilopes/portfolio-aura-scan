import { cn } from "@/lib/utils";

type Confidence = "high" | "medium" | "low";

const TONE: Record<Confidence, string> = {
  high: "bg-success/15 text-success border-success/40",
  medium: "bg-warning/15 text-warning border-warning/40",
  low: "bg-danger/15 text-danger border-danger/40",
};

const ICON: Record<Confidence, string> = {
  high: "✓",
  medium: "⚠",
  low: "⚠⚠",
};

export function ConfidenceBadge({
  confidence,
  yahoo,
  sec,
  label,
}: {
  confidence: Confidence;
  yahoo?: number | null;
  sec?: number | null;
  label?: string;
}) {
  const fmt = (v: number | null | undefined) =>
    v == null
      ? "—"
      : Math.abs(v) >= 1e9
      ? `$${(v / 1e9).toFixed(2)}B`
      : Math.abs(v) >= 1e6
      ? `$${(v / 1e6).toFixed(2)}M`
      : v.toLocaleString();
  const title =
    label && (yahoo != null || sec != null)
      ? `${label}\nYahoo: ${fmt(yahoo)}\nSEC EDGAR: ${fmt(sec)}\nConfidence: ${confidence}`
      : `Confidence: ${confidence}`;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold cursor-help",
        TONE[confidence],
      )}
    >
      {ICON[confidence]}
    </span>
  );
}
