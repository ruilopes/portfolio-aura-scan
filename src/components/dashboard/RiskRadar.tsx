import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip,
} from "recharts";

export function RiskRadar({ data }: { data: { axis: string; value: number }[] }) {
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="75%">
          <defs>
            <radialGradient id="riskGrad">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.4} />
              <stop offset="50%" stopColor="var(--color-warning)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="var(--color-danger)" stopOpacity={0.5} />
            </radialGradient>
          </defs>
          <PolarGrid stroke="var(--color-border)" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: "var(--color-foreground)", fontSize: 12 }} />
          <PolarRadiusAxis domain={[0, 10]} tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} angle={90} />
          <Radar name="Risk" dataKey="value" stroke="var(--color-danger)" fill="url(#riskGrad)" fillOpacity={0.7} strokeWidth={2} />
          <Tooltip
            contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v: any) => `${Number(v).toFixed(1)} / 10`}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
