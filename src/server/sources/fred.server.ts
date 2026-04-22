// FRED CSV source client (no key required for the keyless CSV endpoint).
// Returns the latest non-missing value plus a 3-month-ago value for trend arrows.

const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export type FredPoint = {
  current: number | null;
  previous: number | null; // ~3 months ago
  date: string | null;
};

export type FredBundle = {
  ok: boolean;
  series: Record<string, FredPoint>;
};

async function fetchSeries(seriesId: string): Promise<FredPoint> {
  try {
    const res = await fetch(`${FRED_CSV}?id=${seriesId}`, {
      headers: {
        "User-Agent": "StockAnalysisDashboard/1.0 (research@example.com)",
        Accept: "text/csv,text/plain,*/*",
      },
    });
    if (!res.ok) return { current: null, previous: null, date: null };
    const text = await res.text();
    const lines = text.trim().split("\n").slice(1); // drop header
    const points: { date: string; val: number }[] = [];
    for (const line of lines) {
      const [date, raw] = line.split(",");
      const v = raw?.trim();
      if (v && v !== "." && !isNaN(parseFloat(v))) points.push({ date, val: parseFloat(v) });
    }
    if (!points.length) return { current: null, previous: null, date: null };
    const latest = points[points.length - 1];
    // Find a point ~90 days earlier.
    const latestTs = Date.parse(latest.date);
    let previous: number | null = null;
    if (!isNaN(latestTs)) {
      const target = latestTs - 90 * 24 * 3600 * 1000;
      let best: { dist: number; val: number } | null = null;
      for (const p of points) {
        const t = Date.parse(p.date);
        if (isNaN(t) || t >= latestTs) continue;
        const dist = Math.abs(t - target);
        if (!best || dist < best.dist) best = { dist, val: p.val };
      }
      previous = best?.val ?? null;
    }
    return { current: latest.val, previous, date: latest.date };
  } catch {
    return { current: null, previous: null, date: null };
  }
}

export const FRED_SERIES = [
  "FEDFUNDS",
  "DGS10",
  "DGS2",
  "T10Y2Y",
  "CPIAUCSL",
  "UNRATE",
  "DTWEXBGS",
  "VIXCLS",
  "SP500",
  // European macro
  "ECBDFR",            // ECB Deposit Facility Rate (%)
  "CPHPTT01EZM659N",   // Eurozone HICP YoY (%)
  "DEXUSEU",           // USD per EUR
  // UK macro
  "IUDSOIA",           // BoE SONIA / policy proxy (%)
  "GBRCPIALLMINMEI",   // UK CPI index
  "DEXUSUK",           // USD per GBP
] as const;

export async function fetchFredBundle(): Promise<FredBundle> {
  const results = await Promise.all(FRED_SERIES.map((s) => fetchSeries(s)));
  const series: Record<string, FredPoint> = {};
  let okCount = 0;
  FRED_SERIES.forEach((s, i) => {
    series[s] = results[i];
    if (results[i].current != null) okCount++;
  });
  return { ok: okCount > 0, series };
}

// CPI YoY % change from CPIAUCSL (we have current + ~90d ago, but for true YoY
// we'd need a wider history. Keep this stub for future enhancement.)
export function cpiYoY(latest: number | null, prev: number | null): number | null {
  if (latest == null || prev == null || prev === 0) return null;
  // Annualised from quarter-over-quarter.
  return ((latest - prev) / prev) * 4;
}
