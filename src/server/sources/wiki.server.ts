// Wikipedia summary fallback (no key).

export async function fetchWikiSummary(name: string): Promise<string | null> {
  if (!name) return null;
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "StockAnalysisDashboard/1.0 (research@example.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const ext = data?.extract;
    return typeof ext === "string" && ext.trim().length > 0 ? ext : null;
  } catch {
    return null;
  }
}
