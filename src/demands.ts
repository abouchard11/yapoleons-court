// ─────────────────────────────────────────────────────────────────────
//  The demand bank (CONT-01/02/03) — SEED for the Walking Skeleton
// ─────────────────────────────────────────────────────────────────────
// A static TS bundle (RESEARCH §E): the daily select is a pure client function
// with zero network on the critical path, identical for every player (JUDGE-02),
// and trivially deterministic (CONT-02). Promote to a Supabase table later only
// if hot-swap without an app release is needed (out of scope now).
//
// THIS IS A 2–3-RECORD SEED ONLY. The full 30-demand calibration set (D-01) —
// with the deliberate axis-weight bucket spread (D-03) and the the author voice-review
// pass (D-02) — lands in Plan 01-04. These three seeds exist solely to exercise
// the judge end-to-end and to span distinct weight profiles so the skeleton
// proves that the day's weights are load-bearing.

import { getDayNumber, scramble } from './daily';
import type { Axis } from './judge';

export interface DemandRecord {
  id: string;                        // stable id (for logging / rubric audits)
  scene: string;                     // the framed demand, in Yapoleon's voice (the "scene")
  axisWeights: Record<Axis, number>; // the day's emphasis (D-03) — sums to ~1.0; drives deriveFavorDelta
  rubricVersion: string;             // CONT-03 + the calibration stamp
  tier: 'fairfight';                 // launch tier only
}

// Three seed demands spanning distinct axis-weight profiles (audacity-heavy,
// economy-heavy, specificity-heavy) so the structural weight-shift is real even
// in the skeleton. Each weight vector sums to 1.0.
export const DEMANDS: DemandRecord[] = [
  {
    id: 'seed-audacity-001',
    scene:
      "The Emperor is bored. 'Amuse me,' he says, not looking up. " +
      "'Tell me the most outrageous thing you believe — and dare to mean it.'",
    axisWeights: {
      wit: 0.2,
      specificity: 0.1,
      audacity: 0.5,
      economy: 0.1,
      flattery: 0.1,
    },
    rubricVersion: 'fairfight-v0',
    tier: 'fairfight',
  },
  {
    id: 'seed-economy-002',
    scene:
      "The Emperor raises a single finger. 'I have exactly one moment to spare, " +
      "and you have wasted half of it already. Say something worth the other half — briefly.'",
    axisWeights: {
      wit: 0.2,
      specificity: 0.1,
      audacity: 0.1,
      economy: 0.5,
      flattery: 0.1,
    },
    rubricVersion: 'fairfight-v0',
    tier: 'fairfight',
  },
  {
    id: 'seed-specificity-003',
    scene:
      "The Emperor narrows his eyes. 'Everyone flatters me in generalities. " +
      "Name the one precise thing about my reign that you, and only you, have actually noticed.'",
    axisWeights: {
      wit: 0.15,
      specificity: 0.5,
      audacity: 0.15,
      economy: 0.1,
      flattery: 0.1,
    },
    rubricVersion: 'fairfight-v0',
    tier: 'fairfight',
  },
];

// Deterministic daily select (CONT-02) — mirrors the fork source's getDailyWord.
// Stable shuffle so consecutive days don't walk the list in order. No
// per-difficulty offset (launch is Fair Fight only).
export const selectDailyDemand = (day: number = getDayNumber()): DemandRecord =>
  DEMANDS[scramble(day) % DEMANDS.length];
