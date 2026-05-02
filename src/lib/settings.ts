import { useEffect, useState } from "react";

export interface AppSettings {
  anthropicKey: string;
  showConfidence: boolean;
  showSourceAttribution: boolean;
  cacheMinutes: 5 | 15 | 60 | 1440;
}

const KEY = "stockdash:settings";
// Persistent settings exclude sensitive credentials. The Anthropic API key
// is held in sessionStorage (cleared when the tab closes) to reduce the
// blast radius of any XSS — it cannot be exfiltrated from a stale tab/device.
const SECRET_KEY = "stockdash:anthropic-key";

const DEFAULTS: AppSettings = {
  anthropicKey: "",
  showConfidence: true,
  showSourceAttribution: true,
  cacheMinutes: 15,
};

function read(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    const persisted = raw ? JSON.parse(raw) : {};
    // Strip any legacy persisted key — never read secrets from localStorage.
    delete persisted.anthropicKey;
    const anthropicKey = window.sessionStorage.getItem(SECRET_KEY) ?? "";
    return { ...DEFAULTS, ...persisted, anthropicKey };
  } catch {
    return DEFAULTS;
  }
}

function write(s: AppSettings) {
  if (typeof window === "undefined") return;
  try {
    const { anthropicKey, ...rest } = s;
    window.localStorage.setItem(KEY, JSON.stringify(rest));
    if (anthropicKey) {
      window.sessionStorage.setItem(SECRET_KEY, anthropicKey);
    } else {
      window.sessionStorage.removeItem(SECRET_KEY);
    }
    // Best-effort cleanup of any legacy localStorage entry that contained the key.
    try {
      const legacy = window.localStorage.getItem(KEY);
      if (legacy && legacy.includes("anthropicKey")) {
        window.localStorage.setItem(KEY, JSON.stringify(rest));
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [state, setState] = useState<AppSettings>(DEFAULTS);

  useEffect(() => {
    setState(read());
    const fn = () => setState(read());
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    const next = { ...read(), ...patch };
    write(next);
    setState(next);
    listeners.forEach((l) => l());
  };

  return [state, update];
}

export function getSettings(): AppSettings {
  return read();
}
