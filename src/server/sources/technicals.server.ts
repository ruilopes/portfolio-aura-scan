// Technical analysis helpers (server-side computation).

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period,
    avgL = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function ema(vals: number[], p: number) {
  if (vals.length < p) return [];
  const k = 2 / (p + 1);
  let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const out: number[] = [e];
  for (let i = p; i < vals.length; i++) {
    e = vals[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function macdCalc(values: number[]) {
  if (values.length < 35) return null;
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  const offset = e12.length - e26.length;
  const macdLine = e26.map((v, i) => e12[i + offset] - v);
  const sig = ema(macdLine, 9);
  const m = macdLine[macdLine.length - 1];
  const s = sig[sig.length - 1];
  return { macd: m, signal: s, hist: m - s };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / period);
  return { mid: mean, upper: mean + mult * sd, lower: mean - mult * sd };
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function histVolatility(closes: number[]) {
  const logRets: number[] = [];
  for (let i = Math.max(1, closes.length - 30); i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) logRets.push(Math.log(closes[i] / closes[i - 1]));
  }
  return stddev(logRets) * Math.sqrt(252);
}
