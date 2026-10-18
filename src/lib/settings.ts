import { useEffect, useState } from "react";

export interface AppSettings {
  anthropicKey: string;
  showConfidence: boolean;
  showSourceAttribution: boolean;
  cacheMinutes: 5 | 15 | 60 | 1440;
}

const KEY = "stockdash:settings";
const ANTHROPIC_KEY = "anthropic_api_key";

export const saveAnthropicKey = (key: string) => {
  if (typeof window === "undefined") return;
  if (key) localStorage.setItem(ANTHROPIC_KEY, key);
  else localStorage.removeItem(ANTHROPIC_KEY);
};

export const getAnthropicKey = (): string => {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(ANTHROPIC_KEY) || "";
  } catch {
    return "";
  }
};

export const clearAnthropicKey = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ANTHROPIC_KEY);
};

export const maskKey = (k: string) => {
  if (!k) return "";
  const prefix = k.startsWith("sk-ant-") ? "sk-ant-" : "";
  return `${prefix}${"•".repeat(8)}${k.slice(-4)}`;
};

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
    delete persisted.anthropicKey;
    return { ...DEFAULTS, ...persisted, anthropicKey: getAnthropicKey() };
  } catch {
    return DEFAULTS;
  }
}

function write(s: AppSettings) {
  if (typeof window === "undefined") return;
  try {
    const { anthropicKey, ...rest } = s;
    window.localStorage.setItem(KEY, JSON.stringify(rest));
    saveAnthropicKey(anthropicKey);
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
