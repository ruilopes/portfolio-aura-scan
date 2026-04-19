import { cn } from "@/lib/utils";

export function SourceBadge({ name, ok }: { name: string; ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border",
        ok
          ? "bg-success/10 text-success border-success/30"
          : "bg-danger/10 text-danger border-danger/30"
      )}
      title={ok ? `${name} responded` : `${name} unavailable`}
    >
      {name} {ok ? "✓" : "✗"}
    </span>
  );
}

// ── Per-indicator source pill ────────────────────────────────────────────
// Used next to individual indicator values to attribute the data source.
export type DataSource =
  | "POLY"
  | "TIINGO"
  | "EDGAR"
  | "YAHOO"
  | "FRED"
  | "CALC";

const SOURCE_TONES: Record<DataSource, string> = {
  POLY: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  TIINGO: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  EDGAR: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  YAHOO: "bg-green-500/10 text-green-400 border-green-500/30",
  FRED: "bg-teal-500/10 text-teal-400 border-teal-500/30",
  CALC: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
};

const SOURCE_LABELS: Record<DataSource, string> = {
  POLY: "POLY",
  TIINGO: "TIINGO",
  EDGAR: "SEC",
  YAHOO: "YF",
  FRED: "FRED",
  CALC: "calc",
};

export function sourceNameToCode(s: string | null | undefined): DataSource | null {
  if (!s) return null;
  const x = s.toLowerCase();
  if (x.includes("polygon") || x === "poly") return "POLY";
  if (x.includes("tiingo")) return "TIINGO";
  if (x.includes("edgar") || x === "sec") return "EDGAR";
  if (x.includes("yahoo")) return "YAHOO";
  if (x.includes("fred")) return "FRED";
  if (x.includes("comput") || x === "calc") return "CALC";
  return null;
}

export function SourcePill({ source }: { source: DataSource | string | null | undefined }) {
  const code = typeof source === "string" ? sourceNameToCode(source) : source;
  if (!code) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide border leading-none",
        SOURCE_TONES[code],
      )}
      title={`Source: ${code}`}
    >
      {SOURCE_LABELS[code]}
    </span>
  );
}
