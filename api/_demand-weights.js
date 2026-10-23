// ─────────────────────────────────────────────────────────────────────
//  The per-demand axis-weight table — the ONE source for both sides
// ─────────────────────────────────────────────────────────────────────
// Server-owned axis weights (2026-10-23 HTTP-layer hardening). Before this
// module, the day's weights lived only in src/demands.ts and rode the judge
// request body (`axisWeights`), where the server merely checked "non-negative,
// sum > 0" — so any client could POST inflated weights and receive an arbitrary
// favorDelta. The weights now live HERE, in a plain-JS module the Vercel Node
// runtime can import (it cannot import .ts), and src/demands.ts reads the same
// table — so there is exactly ONE authority and the HTTP body carries none.
//
// Two invariants this file carries, both asserted by tests:
//   1. ORDER matters. selectDailyWeights(day) indexes this array with the SAME
//      scramble(day) % length the client's selectDailyDemand uses over DEMANDS,
//      so the ids here MUST appear in the SAME order as src/demands.ts DEMANDS.
//      (src/demands.test.ts asserts the id sequences are identical; the mirror
//      test in api/_demand-weights.test.js asserts the selected id matches for a
//      wide range of days.)
//   2. VALUES are the fairfight-v2 calibration vectors (CALIBRATION-v2.md) —
//      each sums to ~1.0 (±0.001, enforced in src/demands.test.ts). The D-03
//      bucket rationale (audacity / economy / specificity / flattery-calibration
//      / wit, six per bucket) is documented beside the scenes in src/demands.ts.
//
// Vercel ignores `_`-prefixed files under api/ (not an endpoint) — the same
// convention as _day.js / _cors.js.

// Byte-equivalent to src/daily.ts `scramble` (the stable day shuffle). Kept here
// so the server's selection is a pure function of the server-derived day number.
export function scramble(n) {
  let h = (n + 1) * 2654435761;
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}

// Ordered exactly as src/demands.ts DEMANDS (grouped by D-03 bucket, six each).
export const DEMAND_WEIGHTS = [
  // ── audacity-heavy (6) ──
  { id: 'audacity-most-dangerous', axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.45, economy: 0.1, flattery: 0.1 } },
  { id: 'audacity-correct-the-emperor', axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.4, economy: 0.1, flattery: 0.15 } },
  { id: 'audacity-demand-something', axisWeights: { wit: 0.15, specificity: 0.15, audacity: 0.45, economy: 0.15, flattery: 0.1 } },
  { id: 'audacity-unforgivable-opinion', axisWeights: { wit: 0.2, specificity: 0.1, audacity: 0.5, economy: 0.1, flattery: 0.1 } },
  { id: 'audacity-refuse-him', axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.4, economy: 0.15, flattery: 0.1 } },
  { id: 'audacity-bet-against-him', axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.45, economy: 0.1, flattery: 0.1 } },

  // ── economy-heavy (6) ──
  { id: 'economy-one-breath', axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.1, economy: 0.45, flattery: 0.1 } },
  { id: 'economy-five-words', axisWeights: { wit: 0.25, specificity: 0.15, audacity: 0.1, economy: 0.4, flattery: 0.1 } },
  { id: 'economy-no-throat-clearing', axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.1, economy: 0.45, flattery: 0.1 } },
  { id: 'economy-one-sentence-life', axisWeights: { wit: 0.2, specificity: 0.2, audacity: 0.1, economy: 0.4, flattery: 0.1 } },
  { id: 'economy-cut-it-shorter', axisWeights: { wit: 0.2, specificity: 0.15, audacity: 0.1, economy: 0.45, flattery: 0.1 } },
  { id: 'economy-the-toast', axisWeights: { wit: 0.25, specificity: 0.1, audacity: 0.1, economy: 0.4, flattery: 0.15 } },

  // ── specificity-heavy (6) ──
  { id: 'specificity-one-true-thing', axisWeights: { wit: 0.15, specificity: 0.45, audacity: 0.15, economy: 0.15, flattery: 0.1 } },
  { id: 'specificity-the-detail', axisWeights: { wit: 0.15, specificity: 0.45, audacity: 0.1, economy: 0.2, flattery: 0.1 } },
  { id: 'specificity-not-the-obvious', axisWeights: { wit: 0.2, specificity: 0.45, audacity: 0.1, economy: 0.15, flattery: 0.1 } },
  { id: 'specificity-the-small-tell', axisWeights: { wit: 0.2, specificity: 0.45, audacity: 0.15, economy: 0.1, flattery: 0.1 } },
  { id: 'specificity-name-the-moment', axisWeights: { wit: 0.15, specificity: 0.45, audacity: 0.15, economy: 0.15, flattery: 0.1 } },
  { id: 'specificity-the-flaw', axisWeights: { wit: 0.2, specificity: 0.4, audacity: 0.2, economy: 0.1, flattery: 0.1 } },

  // ── flattery-calibration (6) — flattery dominant but CAPPED ≈0.30 ──
  { id: 'flattery-praise-without-grovel', axisWeights: { wit: 0.25, specificity: 0.25, audacity: 0.15, economy: 0.05, flattery: 0.3 } },
  { id: 'flattery-compliment-with-teeth', axisWeights: { wit: 0.25, specificity: 0.2, audacity: 0.2, economy: 0.05, flattery: 0.3 } },
  { id: 'flattery-earned-not-poured', axisWeights: { wit: 0.18, specificity: 0.28, audacity: 0.16, economy: 0.06, flattery: 0.32 } },
  { id: 'flattery-the-honest-kind', axisWeights: { wit: 0.2, specificity: 0.25, audacity: 0.2, economy: 0.05, flattery: 0.3 } },
  { id: 'flattery-without-the-word-great', axisWeights: { wit: 0.25, specificity: 0.25, audacity: 0.15, economy: 0.05, flattery: 0.3 } },
  { id: 'flattery-the-backhand', axisWeights: { wit: 0.28, specificity: 0.2, audacity: 0.15, economy: 0.05, flattery: 0.32 } },

  // ── wit-heavy (6) ──
  { id: 'wit-statue-golden', axisWeights: { wit: 0.45, specificity: 0.25, audacity: 0.15, economy: 0.1, flattery: 0.05 } },
  { id: 'wit-amuse-or-leave', axisWeights: { wit: 0.5, specificity: 0.15, audacity: 0.15, economy: 0.15, flattery: 0.05 } },
  { id: 'wit-finish-his-thought', axisWeights: { wit: 0.45, specificity: 0.2, audacity: 0.15, economy: 0.15, flattery: 0.05 } },
  { id: 'wit-the-better-insult', axisWeights: { wit: 0.5, specificity: 0.15, audacity: 0.2, economy: 0.1, flattery: 0.05 } },
  { id: 'wit-pun-worth-keeping', axisWeights: { wit: 0.5, specificity: 0.15, audacity: 0.15, economy: 0.15, flattery: 0.05 } },
  { id: 'wit-turn-the-weather', axisWeights: { wit: 0.45, specificity: 0.2, audacity: 0.15, economy: 0.15, flattery: 0.05 } },
];

// id → weights lookup for src/demands.ts (each authored scene pulls its vector
// from here by id, so a weight can never be edited in one place and not the other).
const BY_ID = new Map(DEMAND_WEIGHTS.map((w) => [w.id, w.axisWeights]));
export function weightsFor(id) {
  const w = BY_ID.get(id);
  if (!w) throw new Error(`No axis weights for demand id "${id}"`);
  return w;
}

// Server-side mirror of src/demands.ts selectDailyDemand (CONT-02 / JUDGE-02):
// the SAME scramble(day) % length over the SAME ordered list, so the entry it
// returns is the one whose scene the client is showing that day. Pure; zero network.
export function selectDailyWeights(day) {
  return DEMAND_WEIGHTS[scramble(day) % DEMAND_WEIGHTS.length];
}
