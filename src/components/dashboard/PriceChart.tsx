import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceDot, CartesianGrid,
} from "recharts";
import { fmtPrice } from "@/lib/format";

interface Point { date: string; close: number; sma50: number | null; sma200: number | null }

export function PriceChart({
  data, currentPrice, high52, low52,
}: { data: Point[]; currentPrice: number | null; high52: number | null; low52: number | null }) {
  const last = data[data.length - 1];
  const highPoint = data.reduce((p, c) => (c.close > p.close ? c : p), data[0]);
  const lowPoint = data.reduce((p, c) => (c.close < p.close ? c : p), data[0]);

  return (
    <div className="glass-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="font-semibold">Price (6 months)</h3>
          <p className="text-xs text-muted-foreground">Daily close · SMA 50/200 overlay</p>
        </div>
        <div className="flex gap-4 text-xs">
          <div><span className="inline-block w-3 h-0.5 align-middle" style={{ background: "var(--color-primary)" }} /> Close</div>
          <div><span className="inline-block w-3 h-0.5 align-middle" style={{ background: "var(--color-warning)" }} /> SMA 50</div>
          <div><span className="inline-block w-3 h-0.5 align-middle" style={{ background: "var(--color-danger)" }} /> SMA 200</div>
        </div>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 30, bottom: 5, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} width={55}
              tickFormatter={(v) => `$${v.toFixed(0)}`} />
            <Tooltip
              contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "var(--color-muted-foreground)" }}
              formatter={(v: any) => (v == null ? "—" : `$${Number(v).toFixed(2)}`)}
            />
            <Line type="monotone" dataKey="close" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="sma50" stroke="var(--color-warning)" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="sma200" stroke="var(--color-danger)" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
            {high52 && <ReferenceLine y={high52} stroke="var(--color-success)" strokeDasharray="2 4" label={{ value: `52w H ${fmtPrice(high52)}`, fill: "var(--color-success)", fontSize: 10, position: "right" }} />}
            {low52 && <ReferenceLine y={low52} stroke="var(--color-danger)" strokeDasharray="2 4" label={{ value: `52w L ${fmtPrice(low52)}`, fill: "var(--color-danger)", fontSize: 10, position: "right" }} />}
            {last && currentPrice && <ReferenceDot x={last.date} y={currentPrice} r={5} fill="var(--color-primary)" stroke="var(--color-background)" strokeWidth={2} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
