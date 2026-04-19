export const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null || !isFinite(v) ? "—" : v.toFixed(digits);

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export const fmtPctRaw = (v: number | null | undefined, digits = 1) =>
  v == null || !isFinite(v) ? "—" : `${v.toFixed(digits)}%`;

export const fmtMoney = (v: number | null | undefined) => {
  if (v == null || !isFinite(v)) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(2)}`;
};

export const fmtPrice = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? "—" : `$${v.toFixed(2)}`;

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Robust date parser for Yahoo / FMP / mixed sources.
 * - Yahoo timestamps come in seconds (~1.7e9), some modules use ms (~1.7e12).
 * - FMP returns ISO date strings ("2024-11-05") or full ISO datetimes.
 * - Returns "Date unavailable" when nothing usable is provided.
 */
export const parseYahooDate = (value: unknown): string => {
  if (value == null || value === "") return "Date unavailable";
  if (typeof value === "number" && isFinite(value)) {
    const ms = value < 1e10 ? value * 1000 : value;
    const dt = new Date(ms);
    if (isNaN(dt.getTime())) return "Date unavailable";
    return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  if (typeof value === "string" && value.length >= 4) {
    const dt = new Date(value);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    }
  }
  return "Date unavailable";
};
