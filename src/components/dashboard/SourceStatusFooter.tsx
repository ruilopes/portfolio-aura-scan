import { useState } from "react";
import { cn } from "@/lib/utils";

type Row = { source: string; status: string; fields: string[]; lastFetched: string | null };

const STATUS_TONE: Record<string, string> = {
  ok: "text-success border-success/40 bg-success/10",
  partial: "text-warning border-warning/40 bg-warning/10",
  failed: "text-danger border-danger/40 bg-danger/10",
  "no-key": "text-muted-foreground border-border bg-muted/20",
  "rate-limit": "text-warning border-warning/40 bg-warning/10",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "✓ connected",
  partial: "⚠ partial",
  failed: "✗ failed",
  "no-key": "— no key",
  "rate-limit": "⚠ rate limited",
};

export function SourceStatusFooter({ sources }: { sources: Row[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="glass-card p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Source Status
      </h3>
      <div className="space-y-2">
        {sources.map((s) => {
          const isOpen = expanded === s.source;
          return (
            <div key={s.source} className="border border-border rounded-md overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : s.source)}
                className="w-full flex items-center justify-between gap-3 p-3 hover:bg-muted/30 transition text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-sm">{s.source}</span>
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded border whitespace-nowrap",
                      STATUS_TONE[s.status] || STATUS_TONE.failed,
                    )}
                  >
                    {STATUS_LABEL[s.status] || s.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{s.fields.length} field{s.fields.length === 1 ? "" : "s"}</span>
                  {s.lastFetched && (
                    <span className="hidden sm:inline tabular-nums">
                      {new Date(s.lastFetched).toLocaleTimeString()}
                    </span>
                  )}
                  <span className="text-base">{isOpen ? "▾" : "▸"}</span>
                </div>
              </button>
              {isOpen && s.fields.length > 0 && (
                <div className="px-3 pb-3 pt-1 flex flex-wrap gap-1.5 border-t border-border/50 bg-muted/10">
                  {s.fields.map((f) => (
                    <span
                      key={f}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
