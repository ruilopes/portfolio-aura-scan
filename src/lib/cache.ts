// localStorage cache wrapper for analysis results.

const PREFIX = "stockdash:";

export function cacheGet<T = any>(key: string, ttlMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { ts, v } = JSON.parse(raw);
    if (typeof ts !== "number") return null;
    if (Date.now() - ts > ttlMs) {
      window.localStorage.removeItem(PREFIX + key);
      return null;
    }
    return v as T;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), v: value }));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function cacheClearAll() {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  keys.forEach((k) => window.localStorage.removeItem(k));
}
