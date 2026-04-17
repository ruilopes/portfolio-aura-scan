// Scoring utilities — sub-scores 0-10, composite 0-100

export type Status = "good" | "neutral" | "bad";
export const statusFromScore = (s: number): Status => (s >= 7 ? "good" : s >= 4 ? "neutral" : "bad");

const band = (v: number | null | undefined, breaks: [number, number][]): number => {
  if (v === null || v === undefined || !isFinite(v)) return 5;
  for (const [t, score] of breaks) if (v < t) return score;
  return breaks[breaks.length - 1][1];
};

export const scorePE = (v?: number | null) => band(v, [[15, 10], [25, 7], [35, 4], [Infinity, 1]]);
export const scoreFwdPE = (v?: number | null) => band(v, [[12, 10], [20, 7], [30, 4], [Infinity, 1]]);
export const scoreEvEbitda = (v?: number | null) => band(v, [[8, 10], [15, 7], [25, 4], [Infinity, 1]]);
export const scorePEG = (v?: number | null) => band(v, [[1, 10], [1.5, 7], [2, 4], [Infinity, 1]]);
export const scoreGrossMargin = (v?: number | null) => {
  if (v == null) return 5; if (v > 0.5) return 10; if (v > 0.3) return 7; if (v > 0.15) return 4; return 1;
};
export const scoreROE = (v?: number | null) => {
  if (v == null) return 5; if (v > 0.2) return 10; if (v > 0.1) return 7; if (v > 0) return 4; return 1;
};
export const scoreDE = (v?: number | null) => band(v, [[0.3, 10], [1, 7], [2, 4], [Infinity, 1]]);
export const scoreFCFYield = (v?: number | null) => {
  if (v == null) return 5; if (v > 0.05) return 10; if (v > 0.02) return 7; if (v > 0) return 4; return 1;
};
export const scoreRevGrowth = (v?: number | null) => {
  if (v == null) return 5; if (v > 0.2) return 10; if (v > 0.1) return 7; if (v > 0) return 4; return 1;
};
export const scoreEPSGrowth = (v?: number | null) => {
  if (v == null) return 5; if (v > 0.15) return 10; if (v > 0.05) return 7; if (v > 0) return 4; return 1;
};
export const scoreRSI = (v?: number | null) => {
  if (v == null) return 5;
  if (v >= 40 && v <= 60) return 10;
  if ((v >= 30 && v < 40) || (v > 60 && v <= 70)) return 6;
  return 3;
};
export const scorePriceVs200 = (pct?: number | null) => {
  if (pct == null) return 5;
  if (pct > 0.1) return 4; if (pct > 0) return 10; if (pct > -0.1) return 7; return 3;
};
export const scoreConsensus = (v?: number | null) => {
  // 1=strong buy ... 5=strong sell (FMP convention varies)
  if (v == null) return 5;
  if (v <= 1.5) return 10; if (v <= 2.5) return 7; if (v <= 3.5) return 4; return 1;
};
export const scoreShortInterest = (v?: number | null) => {
  if (v == null) return 5; if (v < 0.03) return 10; if (v < 0.07) return 7; if (v < 0.15) return 4; return 1;
};
export const scoreUpside = (v?: number | null) => {
  if (v == null) return 5; if (v > 0.3) return 10; if (v > 0.15) return 7; if (v > 0) return 4; return 1;
};
export const scoreBeta = (v?: number | null) => {
  if (v == null) return 5; if (v < 0.8) return 10; if (v < 1.2) return 8; if (v < 1.8) return 5; return 2;
};
export const scoreBeatRate = (beats?: number | null, total = 4) => {
  if (beats == null) return 5;
  const r = beats / total;
  if (r >= 1) return 10; if (r >= 0.75) return 7; if (r >= 0.5) return 4; return 1;
};

export const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 5);

export const composite = (cards: { score: number; weight: number }[]) => {
  const totalW = cards.reduce((s, c) => s + c.weight, 0);
  const weighted = cards.reduce((s, c) => s + c.score * c.weight, 0);
  return Math.round((weighted / totalW) * 10); // 0-100
};

export const riskBand = (composite: number) => {
  if (composite >= 65) return { label: "Low Risk", tone: "success" as const, emoji: "🟢" };
  if (composite >= 35) return { label: "Medium Risk", tone: "warning" as const, emoji: "🟡" };
  return { label: "High Risk", tone: "danger" as const, emoji: "🔴" };
};
