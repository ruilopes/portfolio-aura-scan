import { cn } from "@/lib/utils";
import { ScoreBar, StatusDot } from "./ScoreBar";
import { SourceBadge } from "./SourceBadge";
import { fmtNum, fmtPct, fmtPctRaw, fmtPriceCcy, fmtMoneyCcy } from "@/lib/format";

interface Indicator { k: string; v: number | null; s: number }

interface Props {
  title: string;
  weight: number;
  score: number; // 0-10
  indicators: Indicator[];
  source: string;
  extras?: Record<string, any>;
  formatHint?: Record<string, "pct" | "num" | "price" | "ratio">;
  currencySymbol?: string;
}

const guessFormat = (label: string): "pct" | "num" | "price" => {
  const l = label.toLowerCase();
  if (l.includes("margin") || l.includes("growth") || l.includes("yield") || l.includes("interest") || l.includes("upside") || l.includes("roe") || l.includes("roa") || l.includes("roic")) return "pct";
  if (l.includes("price") || l.includes("target")) return "price";
  return "num";
};

const fmtVal = (label: string, v: number | null, ccy: string) => {
  const f = guessFormat(label);
  if (f === "pct") return fmtPct(v);
  if (f === "price") return fmtPriceCcy(v, ccy);
  return fmtNum(v);
};

export function FundamentalCard({ title, weight, score, indicators, source, extras, currencySymbol = "$" }: Props) {
  const tone = score >= 7 ? "text-success" : score >= 4 ? "text-warning" : "text-danger";
  return (
    <div className="glass-card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base">{title}</h3>
            <span className="text-xs text-muted-foreground rounded bg-muted px-1.5 py-0.5">w {weight}%</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Source: {source}</div>
        </div>
        <div className="text-right">
          <div className={cn("text-2xl font-bold tabular-nums", tone)}>{score.toFixed(1)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">/ 10</div>
        </div>
      </div>

      <div className="space-y-2.5">
        {indicators.map((ind) => (
          <div key={ind.k} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <StatusDot score={ind.s} />
                {ind.k}
              </span>
              <span className="font-medium tabular-nums">{fmtVal(ind.k, ind.v, currencySymbol)}</span>
            </div>
            <ScoreBar score={ind.s} />
          </div>
        ))}
      </div>

      {extras && Object.keys(extras).length > 0 && (
        <div className="border-t border-border/50 pt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {Object.entries(extras).map(([k, v]) => {
            if (v == null || (typeof v === "object" && !Array.isArray(v))) return null;
            const isPct = /margin|growth|yield|own|perf|vol|qoq|cagr|upside/i.test(k);
            const isMoney = /price|target|cap|cash|debt|revenue|fcf|enterprisevalue|ev|share/i.test(k) && !isPct;
            return (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-muted-foreground capitalize truncate">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                <span className="tabular-nums">
                  {typeof v === "number"
                    ? (isPct ? fmtPct(v) : isMoney ? fmtMoneyCcy(v, currencySymbol) : fmtNum(v))
                    : String(v)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
