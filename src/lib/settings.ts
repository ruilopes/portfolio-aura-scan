import { useEffect, useState } from "react";

export interface AppSettings {
  anthropicKey: string;
  fmpKey: string;
  avKey: string;
  showConfidence: boolean;
  showSecCrossCheck: boolean;
  showSourceAttribution: boolean;
  cacheMinutes: 5 | 15 | 60 | 1440;
}

const KEY = "stockdash:settings";

const DEFAULTS: AppSettings = {
  anthropicKey: "",
  fmpKey: "",
  avKey: "",
  showConfidence: true,
  showSecCrossCheck: true,
  showSourceAttribution: true,
  cacheMinutes: 15,
};

function read(): AppSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function write(s: AppSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
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
