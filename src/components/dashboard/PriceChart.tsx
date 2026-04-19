import { useMemo, useState } from "react";
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot, CartesianGrid, Legend,
} from "recharts";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Point {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
  sma50: number | null;
  sma200: number | null;
  bbUpper?: number | null;
  bbMid?: number | null;
  bbLower?: number | null;
}

type Range = "1M" | "3M" | "6M" | "1Y";
const RANGE_DAYS: Record<Range, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };

export function PriceChart({
  data,
  currentPrice,
  high52,
  low52,
  crossEvent,
}: {
  data: Point[];
  currentPrice: number | null;
  high52: number | null;
  low52: number | null;
  crossEvent?: { type: "golden" | "death"; daysAgo: number; date: string } | null;
}) {
  const [range, setRange] = useState<Range>("1Y");

  const visible = useMemo(() => {
    const n = RANGE_DAYS[range];
    return data.slice(-n);
  }, [data, range]);

  // Recharts wants stacked bands → bbBand = bbUpper - bbLower, base = bbLower.
  const chartData = useMemo(
    () =>
      visible.map((p) => ({
        ...p,
        ts: new Date(p.date).getTime(),
        bbBand: p.bbUpper != null && p.bbLower != null ? p.bbUpper - p.bbLower : null,
      })),
    [visible],
  );

  // Fixed X-axis window: exactly 52 weeks ago → today. Shorter ranges zoom from the right.
  const xDomain = useMemo<[number, number]>(() => {
    const today = Date.now();
    const fullStart = today - 365 * 24 * 60 * 60 * 1000;
    const rangeMs: Record<Range, number> = {
      "1M": 30 * 24 * 60 * 60 * 1000,
      "3M": 91 * 24 * 60 * 60 * 1000,
      "6M": 182 * 24 * 60 * 60 * 1000,
      "1Y": 365 * 24 * 60 * 60 * 1000,
    };
    const start = range === "1Y" ? fullStart : today - rangeMs[range];
    return [start, today];
  }, [range]);

  const yDomain = useMemo<[number, number]>(() => {
    if (high52 != null && low52 != null && high52 > low52) {
      const buffer = (high52 - low52) * 0.03;
      return [low52 - buffer, high52 + buffer];
    }
    const lows = chartData.map((p) => p.low ?? p.close).filter((v): v is number => v != null);
    const highs = chartData.map((p) => p.high ?? p.close).filter((v): v is number => v != null);
    if (lows.length && highs.length) {
      const lo = Math.min(...lows);
      const hi = Math.max(...highs);
      const buffer = (hi - lo) * 0.03;
      return [lo - buffer, hi + buffer];
    }
    return [0, 0];
  }, [chartData, high52, low52]);

  const lastClose = visible[visible.length - 1]?.close ?? currentPrice;
  const cp = currentPrice ?? lastClose ?? 0;
  const pos52w =
    high52 != null && low52 != null && high52 > low52
      ? Math.max(0, Math.min(100, ((cp - low52) / (high52 - low52)) * 100))
      : null;

  const hasSma200InWindow = chartData.some((p) => p.sma200 != null);
  const crossInWindow =
    crossEvent && chartData.some((p) => p.date === crossEvent.date);

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="font-semibold">Price ({range})</h3>
          <p className="text-xs text-muted-foreground">
            Daily OHLCV · SMA 50/200 · Bollinger Bands (20, 2σ) · Volume
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["1M", "3M", "6M", "1Y"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "text-xs px-2.5 py-1 rounded border transition",
                range === r
                  ? "bg-primary/20 text-primary border-primary/40"
                  : "bg-muted/20 text-muted-foreground border-border hover:bg-muted/40",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><span className="inline-block w-3 h-0.5 align-middle" style={{ background: "var(--color-primary)" }} /> Close</span>
        <span><span className="inline-block w-3 h-0.5 align-middle" style={{ background: "var(--color-warning)" }} /> SMA 50</span>
        <span><span className="inline-block w-3 h-0.5 align-middle" style={{ background: "var(--color-danger)" }} /> SMA 200</span>
        <span><span className="inline-block w-3 h-2 align-middle opacity-30" style={{ background: "var(--color-primary)" }} /> Bollinger 20·2σ</span>
        <span><span className="inline-block w-3 h-2 align-middle opacity-50" style={{ background: "var(--color-muted-foreground)" }} /> Volume</span>
      </div>

      {/* Main price chart */}
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 5, right: 30, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={xDomain}
              allowDataOverflow
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              minTickGap={40}
              tickFormatter={(ts) =>
                new Date(Number(ts)).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
              }
            />
            <YAxis
              yAxisId="price"
              domain={yDomain}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              width={55}
              tickFormatter={(v) => `$${Number(v).toFixed(2)}`}
            />
            <Tooltip
              contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "var(--color-muted-foreground)" }}
              labelFormatter={(ts) => new Date(Number(ts)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              formatter={(v: any, name: any) => {
                const label = String(name ?? "");
                if (v == null) return ["—", label];
                if (label === "Volume") return [Number(v).toLocaleString(), label];
                return [`$${Number(v).toFixed(2)}`, label];
              }}
            />
            {/* Bollinger Band — stacked: invisible base + translucent band */}
            <Area yAxisId="price" type="monotone" dataKey="bbLower" stackId="bb" stroke="none" fill="transparent" name="BB Lower" />
            <Area yAxisId="price" type="monotone" dataKey="bbBand" stackId="bb" stroke="none" fill="var(--color-primary)" fillOpacity={0.08} name="Bollinger" />
            <Line yAxisId="price" type="monotone" dataKey="close" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="Close" />
            <Line yAxisId="price" type="monotone" dataKey="sma50" stroke="var(--color-warning)" strokeWidth={1.5} dot={false} name="SMA 50" />
            <Line yAxisId="price" type="monotone" dataKey="sma200" stroke="var(--color-danger)" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="SMA 200" />
            {low52 && <ReferenceLine yAxisId="price" y={low52} stroke="var(--color-danger)" strokeDasharray="2 4" label={{ value: `52w L ${fmtPrice(low52)}`, fill: "var(--color-danger)", fontSize: 10, position: "right" }} />}
            {crossInWindow && (
              <ReferenceLine
                yAxisId="price"
                x={new Date(crossEvent!.date).getTime()}
                stroke={crossEvent!.type === "golden" ? "var(--color-success)" : "var(--color-danger)"}
                strokeDasharray="3 3"
                label={{
                  value: crossEvent!.type === "golden" ? "Golden Cross" : "Death Cross",
                  fill: crossEvent!.type === "golden" ? "var(--color-success)" : "var(--color-danger)",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            )}
            {lastClose != null && chartData.length > 0 && (
              <ReferenceDot yAxisId="price" x={chartData[chartData.length - 1].ts} y={lastClose} r={5} fill="var(--color-primary)" stroke="var(--color-background)" strokeWidth={2} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume bars */}
      <div className="h-20 w-full -mt-2">
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 0, right: 30, bottom: 5, left: 0 }}>
            <XAxis
              dataKey="date"
              type="category"
              domain={["dataMin", "dataMax"]}
              allowDataOverflow={false}
              tick={false}
              axisLine={false}
              height={0}
            />
            <YAxis
              domain={[0, "auto"]}
              allowDataOverflow={false}
              tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
              width={55}
              tickFormatter={(v) => {
                const n = Number(v);
                if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
                if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
                if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
                return String(n);
              }}
            />
            <Tooltip
              contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              formatter={(v: any) => [Number(v).toLocaleString(), "Volume"]}
            />
            <Bar dataKey="volume" fill="var(--color-muted-foreground)" fillOpacity={0.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {!hasSma200InWindow && (
        <p className="text-[11px] text-muted-foreground italic">
          SMA 200 requires 200 trading days — shown from day 200 onwards.
        </p>
      )}

      {/* 52-week range bar */}
      {pos52w != null && high52 != null && low52 != null && (
        <div className="space-y-1.5 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>52w Low <span className="text-foreground font-medium">{fmtPrice(low52)}</span></span>
            <span>{pos52w.toFixed(0)}th percentile</span>
            <span>52w High <span className="text-foreground font-medium">{fmtPrice(high52)}</span></span>
          </div>
          <div className="relative h-2 bg-muted/40 rounded-full overflow-hidden">
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background"
              style={{ left: `${pos52w}%` }}
            />
          </div>
          <div className="text-[11px] text-muted-foreground text-center">
            now {fmtPrice(cp)}
          </div>
        </div>
      )}

      {/* Cross alert */}
      {crossEvent && (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            crossEvent.type === "golden"
              ? "bg-success/10 border-success/30 text-success"
              : "bg-danger/10 border-danger/30 text-danger",
          )}
        >
          <div className="font-semibold">
            {crossEvent.type === "golden" ? "🟢 Golden Cross" : "🔴 Death Cross"} detected{" "}
            {crossEvent.daysAgo} trading day{crossEvent.daysAgo === 1 ? "" : "s"} ago
          </div>
          <div className="text-xs opacity-90 mt-0.5">
            {crossEvent.type === "golden"
              ? "SMA 50 crossed above SMA 200 — historically a bullish signal."
              : "SMA 50 crossed below SMA 200 — historically a bearish signal."}
          </div>
        </div>
      )}
    </div>
  );
}
