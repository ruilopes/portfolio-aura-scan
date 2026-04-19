import { useState } from "react";
import { cn } from "@/lib/utils";
import { fmtNum, fmtPct, fmtPrice } from "@/lib/format";

interface Indicator {
  k: string;
  v: number | null;
  s: number;
}

interface Card {
  id: string;
  title: string;
  weight: number;
  score: number; // 0-10
  indicators: Indicator[];
}

interface Props {
  cards: Card[];
  composite: number; // 0-100
  riskLabel: string;
  riskTone: "success" | "warning" | "danger";
  summary: string;
}

const toneClass = (s: number) =>
  s >= 7 ? "bg-success" : s >= 4 ? "bg-warning" : "bg-danger";
const toneText = (s: number) =>
  s >= 7 ? "text-success" : s >= 4 ? "text-warning" : "text-danger";

const guessFormat = (label: string): "pct" | "num" | "price" => {
  const l = label.toLowerCase();
  if (
    l.includes("margin") || l.includes("growth") || l.includes("yield") ||
    l.includes("interest") || l.includes("upside") || l.includes("roe") ||
    l.includes("roa") || l.includes("roic")
  ) return "pct";
  if (l.includes("price") || l.includes("target")) return "price";
  return "num";
};

const fmtVal = (label: string, v: number | null) => {
  const f = guessFormat(label);
  if (f === "pct") return fmtPct(v);
  if (f === "price") return fmtPrice(v);
  return fmtNum(v);
};

const scrollToCard = (id: string) => {
  const el = document.getElementById(`card-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

export function ScoreBreakdown({ cards, composite, riskLabel, riskTone, summary }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const totalWeight = cards.reduce((s, c) => s + c.weight, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 w-full">
      {/* Part A — Category bars */}
      <div className="lg:col-span-3 space-y-2.5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Score Breakdown · click a row to drill down
        </div>
        {cards.map((c) => {
          const pctOfWeight = (c.weight / totalWeight) * 100;
          const contrib = (c.score * c.weight) / 10; // out of weight pts; weights sum ≈ 100
          const isOpen = expanded === c.id;
          return (
            <div key={c.id} className="rounded-md border border-border/60 bg-card/40">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : c.id)}
                className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-muted/40 rounded-md transition-colors"
              >
                <span className="w-40 shrink-0 text-sm font-medium truncate">{c.title}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", toneClass(c.score))}
                    style={{ width: `${Math.max(0, Math.min(10, c.score)) * 10}%` }}
                  />
                </div>
                <span className={cn("w-16 text-right text-sm font-semibold tabular-nums", toneText(c.score))}>
                  {c.score.toFixed(1)} / 10
                </span>
                <span className="hidden sm:inline w-16 text-right text-xs text-muted-foreground tabular-nums">
                  w {pctOfWeight.toFixed(0)}%
                </span>
                <span className="hidden md:inline w-24 text-right text-xs text-muted-foreground tabular-nums">
                  → {contrib.toFixed(1)} pts
                </span>
                <span className="text-xs text-muted-foreground w-3 text-right">{isOpen ? "▾" : "▸"}</span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-border/40">
                  {c.indicators.length === 0 && (
                    <div className="text-xs text-muted-foreground italic py-1">No indicators.</div>
                  )}
                  {c.indicators.map((ind) => (
                    <div key={ind.k} className="flex items-center gap-3 text-xs">
                      <span className="w-40 shrink-0 text-muted-foreground truncate">{ind.k}</span>
                      <span className="w-20 text-right tabular-nums">{fmtVal(ind.k, ind.v)}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", toneClass(ind.s))}
                          style={{ width: `${Math.max(0, Math.min(10, ind.s)) * 10}%` }}
                        />
                      </div>
                      <span className={cn("w-12 text-right tabular-nums", toneText(ind.s))}>
                        {ind.s.toFixed(0)}/10
                      </span>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); scrollToCard(c.id); }}
                    className="text-xs text-primary hover:underline mt-1"
                  >
                    Jump to {c.title} section →
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div className="flex items-center justify-end gap-3 pt-2 text-xs text-muted-foreground">
          <span>TOTAL</span>
          <span className={cn("font-semibold tabular-nums text-sm", toneText(composite / 10))}>
            {composite} / 100
          </span>
        </div>
      </div>

      {/* Part B — Classification badge */}
      <div className="lg:col-span-2">
        <div className={cn(
          "rounded-xl border p-5 flex flex-col items-center text-center gap-2",
          `border-${riskTone}/40 bg-${riskTone}/5`,
        )}>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Composite Score
          </div>
          <div className={cn("text-6xl font-bold tabular-nums leading-none", `text-${riskTone}`)}>
            {composite}
          </div>
          <div className={cn(
            "px-3 py-1 rounded-full text-sm font-semibold",
            `bg-${riskTone}/10 text-${riskTone} border border-${riskTone}/30`,
          )}>
            {riskLabel}
          </div>
          <p className="text-sm text-muted-foreground italic mt-2 max-w-xs">
            "{summary}"
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 justify-center text-xs">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => scrollToCard(c.id)}
              className="text-primary hover:underline"
            >
              → {c.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
