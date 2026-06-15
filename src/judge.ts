// ─────────────────────────────────────────────────────────────────────
//  The judge contract — the fairness backbone (JUDGE-03)
// ─────────────────────────────────────────────────────────────────────
// No fork analog: this is genuinely net-new (RESEARCH §C/§G, PATTERNS "No
// Analog Found"). The model returns TASTE (5 axis sub-scores + dominantAxis +
// reaction); the SERVER computes favorDelta from those scores × the day's
// weights. The model NEVER emits favorDelta — that is the anti-"Suck Up!"
// fairness backbone: the curve is server-owned and identical for everyone that
// day. Letting the model return the delta reintroduces the review-bomb trap
// (RESEARCH Pitfall 3).
//
// This module is shared CONCEPTUALLY with api/court-judge.js (the server reuses
// the same deriveFavorDelta math), but the Vercel Node runtime cannot import a
// .ts file into a .js serverless function, so court-judge.js carries its own
// plain-JS copy of clamp01 / AXES / deriveFavorDelta (kept byte-equivalent).

// The 5 canonical axes — the rubric IS Yapoleon's personality (RESEARCH §C/§G).
export type Axis = 'wit' | 'specificity' | 'audacity' | 'economy' | 'flattery';

export const AXES: Axis[] = ['wit', 'specificity', 'audacity', 'economy', 'flattery'];

// The CLIENT-FACING result contract (RESEARCH §G). favorDelta is added by the
// server after the model call — it is NOT part of the model's output schema.
export interface JudgeResult {
  axisScores: Record<Axis, number>; // 0..1 each (from the model)
  favorDelta: number;               // −20..+55 (SERVER-derived, NOT from the model)
  dominantAxis: Axis;
  reaction: string;                 // in-voice line (the screenshot beat)
}

// Clamp any model-emitted axis score to the valid [0,1] range. A model returning
// 1.4 is treated as 1; a negative score as 0; a non-number as 0.
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, Number(n) || 0));

// v0 curve — the §B calibration target (tuned to a 55–70% median win-rate in
// Plan 01-06; this is the FIRST guess, deliberately simple/linear).
//   weighted 0 → −20 (worst turn, the floor of the band)
//   weighted 1 → +55 (best turn, the top of the band)
// Solvability invariant holds: max delta 55 × 3 turns = 165 ≥ 100 (METER-03).
const mapToBand = (weighted: number): number => Math.round(-20 + weighted * 75);

// deriveFavorDelta — the ONLY place favorDelta is computed (RESEARCH Pitfall 3).
// Pure function of axisScores + the day's weights:
//   weighted = Σ_axis clamp01(axisScores[axis]) * dayWeights[axis]   (0..1)
//   favorDelta = mapToBand(weighted)                                 (−20..+55)
// Same inputs → same output every call; no mutation of the inputs.
export const deriveFavorDelta = (
  axisScores: Record<Axis, number>,
  dayWeights: Record<Axis, number>,
): number => {
  const weighted = AXES.reduce(
    (sum, ax) => sum + clamp01(axisScores[ax]) * (Number(dayWeights[ax]) || 0),
    0,
  );
  return mapToBand(weighted);
};
