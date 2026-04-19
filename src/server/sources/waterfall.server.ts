// Source-attribution waterfall fetcher.
//
// Pattern: indicators have an ordered list of candidate sources. We pick the
// first source that returns a non-null, non-zero numeric (or a non-empty
// string/array). The picker also records which source each indicator came from
// so the UI can show attribution.

export type SourceName =
  | "Yahoo"
  | "Yahoo Chart"
  | "Polygon"
  | "Tiingo"
  | "SEC EDGAR"
  | "FRED"
  | "computed";

export type Indicator<T = number | null> = {
  value: T;
  source: SourceName | null;
};

const isMeaningful = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return Boolean(v);
};

// Allow zero as a valid value for some indicators (e.g. interest rates, growth
// percentages). Caller passes acceptZero=true.
const isMeaningfulAllowZero = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return Number.isFinite(v);
  return isMeaningful(v);
};

export type Candidate<T> = { source: SourceName; get: () => T | null | undefined };

// When Yahoo is rate-limited, we demote any "Yahoo" / "Yahoo Chart" candidate
// to the back of the priority list — without rewriting every pick() call.
let yahooDemoted = false;
export function setYahooDemoted(v: boolean): void {
  yahooDemoted = v;
}
function reorder<T>(candidates: Candidate<T>[]): Candidate<T>[] {
  if (!yahooDemoted) return candidates;
  const yahoo = candidates.filter((c) => c.source === "Yahoo" || c.source === "Yahoo Chart");
  const rest = candidates.filter((c) => c.source !== "Yahoo" && c.source !== "Yahoo Chart");
  return [...rest, ...yahoo];
}

export function pick<T>(
  candidates: Candidate<T>[],
  opts: { acceptZero?: boolean } = {},
): Indicator<T | null> {
  const test = opts.acceptZero ? isMeaningfulAllowZero : isMeaningful;
  for (const c of reorder(candidates)) {
    try {
      const v = c.get();
      if (test(v)) return { value: v as T, source: c.source };
    } catch {
      /* try next */
    }
  }
  return { value: null, source: null };
}

// Async variant for cases where each candidate involves an HTTP call (rare —
// most candidates read from already-cached source results).
export async function pickAsync<T>(
  candidates: { source: SourceName; get: () => Promise<T | null | undefined> }[],
  opts: { acceptZero?: boolean } = {},
): Promise<Indicator<T | null>> {
  const test = opts.acceptZero ? isMeaningfulAllowZero : isMeaningful;
  for (const c of candidates) {
    try {
      const v = await c.get();
      if (test(v)) return { value: v as T, source: c.source };
    } catch {
      /* try next */
    }
  }
  return { value: null, source: null };
}

// Track which indicators came from which source for the source-status footer.
export class SourceLedger {
  private fields = new Map<SourceName, Set<string>>();
  private status = new Map<SourceName, "ok" | "partial" | "failed" | "no-key" | "rate-limit">();
  private timestamps = new Map<SourceName, string>();

  setStatus(source: SourceName, status: "ok" | "partial" | "failed" | "no-key" | "rate-limit") {
    this.status.set(source, status);
    this.timestamps.set(source, new Date().toISOString());
  }

  record(name: string, indicator: Indicator<unknown>) {
    if (!indicator.source) return;
    if (!this.fields.has(indicator.source)) this.fields.set(indicator.source, new Set());
    this.fields.get(indicator.source)!.add(name);
  }

  toJSON() {
    const out: { source: SourceName; status: string; fields: string[]; lastFetched: string | null }[] = [];
    const allSources: SourceName[] = ["Yahoo", "Yahoo Chart", "Polygon", "Tiingo", "SEC EDGAR", "FRED"];
    for (const s of allSources) {
      out.push({
        source: s,
        status: this.status.get(s) || "failed",
        fields: Array.from(this.fields.get(s) || []).sort(),
        lastFetched: this.timestamps.get(s) || null,
      });
    }
    return out;
  }
}
