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

// fairfight-v2 (Phase 2: JUDGE-04/06 hardening). The CURVE below is byte-unchanged
// from the fairfight-v1 calibration — CALIBRATED 2026-06-15 (Plan 01-06, D-07) via a
// capture-once-then-fit-offline sweep over a pooled 6-run sample (see CALIBRATION.md).
// The CALIBRATION METRIC is the mean/overall mid win-rate: the per-demand median is
// bimodal/degenerate (~1 of 30 demands is "contested"), so it is not tunable — see
// CALIBRATION.md "Why mean, not median". The v2 bump (JUDGE-08) records that the
// PROMPT-side scoring changed (flattery now scores lower, injection now docks); the favor
// MATH (mapToBand / deriveFavorDelta) is unchanged from v1.
//
// MEASURED UNDER v2 (Plan 02-02, live 2026-06-16, runsPerCell 3, 1095 judge calls, 0
// errors — see CALIBRATION-v2.md): representative (mean mid) win-rate 72.2%, weak 0%,
// strong 96.7% (learnable), fixed mold 0% off-axis (the structural defense holds), and all
// 5 anti-gaming probes PASS live. 72.2% sits ~2.2 pts above the 55–70% target ceiling —
// within the 3-run sampling band, and partly the intended F2 effect (legitimate boldness is
// no longer mis-docked as insolence). Accepted and locked by operator sign-off 2026-06-16.
//
// (v1's ~62%, fit 2026-06-15 over a pooled 6-run sample, is the PRIOR — retained in
// CALIBRATION.md as the method of record, not as the shipping number.)
//   weighted 0 → −28 (worst turn, the floor of the band)
//   weighted 1 → +52 (best turn, the top of the band)
// Solvability invariant holds: max delta 52 × 3 turns = 156 ≥ 100 (METER-03).
const mapToBand = (weighted: number): number => Math.round(-28 + weighted * 80);
export const RUBRIC_VERSION = 'fairfight-v2';

// deriveFavorDelta — the ONLY place favorDelta is computed (RESEARCH Pitfall 3).
// Pure function of axisScores + the day's weights:
//   weighted = Σ_axis clamp01(axisScores[axis]) * dayWeights[axis]   (0..1)
//   favorDelta = mapToBand(weighted)                                 (−28..+52)
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
