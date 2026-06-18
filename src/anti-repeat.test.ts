/**
 * Anti-repeat calibration pin (JUDGE-05, Plan 03-03 Task 3 — created in-wave so the
 * blocking calibration gate is closed before Plan 04 runs; 03-04 EXTENDS/confirms it).
 *
 * Pins the calibrated NEAR_DUP_THRESHOLD: every labeled near-duplicate pair flags
 * (trigramJaccardSimilarity >= threshold) and every genuinely-distinct-but-clever pair
 * passes (< threshold). A false positive — a wrong "I've heard that one" on a brand-new
 * clever line — is the fairness risk this guards (the same concern as Phase 2's injection
 * false-positive). On the calibration fixture (scripts/calibrate-anti-repeat.mjs) the FP
 * rate is 0% across 0.50–0.70 because distinct answers cluster at <=0.12 while repeats sit
 * at 0.42–1.0; 0.60 (the research default) was selected for the widest safety margin.
 *
 * The threshold lives module-private in api/court-judge.js, so it is pinned by TEXT here
 * (the same readProd discipline voice-integrity.test.ts uses for the .js mirrors): a drift
 * of the constant OR the similarity primitive fails this test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// api/*.js is plain ESM with no .d.ts — vitest/vite resolves it at runtime; tsc would
// otherwise flag TS7016 (implicit any). This is the SAME deterministic primitive the
// judge folds into its single call, so the calibration pin must exercise the real function.
// @ts-ignore
import { trigramJaccardSimilarity } from '../api/_yapoleon-observability.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROD_COURT_JUDGE_JS = readFileSync(resolve(HERE, '..', 'api/court-judge.js'), 'utf8');

// The operator-reviewed value (Plan 03-03 Task 3 calibration). Changing it requires a fresh
// sweep + re-confirmed FP rate — do NOT "just update the number" without re-calibrating.
const CALIBRATED_THRESHOLD = 0.6;

// Labeled fixture (a subset of scripts/calibrate-anti-repeat.mjs). Each pair answers the
// SAME demand. REPEAT = the player resubmitting the same idea (exact / reordered / reworded
// — all measured >= 0.6). DISTINCT = a genuinely new clever answer (all measured <= 0.12).
const NEAR_DUP_PAIRS: Array<[string, string]> = [
  // exact resubmission
  ['A statue would only diminish you, Sire — marble cannot smirk.',
   'A statue would only diminish you, Sire — marble cannot smirk.'],
  // reordered clauses
  ['Marble cannot smirk, Sire; a statue would only diminish you.',
   'A statue would only diminish you, Sire — marble cannot smirk.'],
  // near-verbatim with filler words
  ['You are, quite simply, the greatest mind the court has ever known.',
   'You are simply the greatest mind this court has ever known.'],
];

const DISTINCT_PAIRS: Array<[string, string]> = [
  ['A statue would only diminish you, Sire — marble cannot smirk.',
   'Commission it. Future emperors deserve something to feel inadequate beside.'],
  ['Your genius needs no monument.',
   'I refuse — a likeness would only teach the people to expect two of you.'],
  // the hardest false-positive case: both flattery-shaped, yet distinct
  ['No monument could flatter a man the gods already over-favored.',
   'Your reflection has done more honest worship than any sculptor could.'],
];

describe('anti-repeat threshold calibration (JUDGE-05)', () => {
  it(`court-judge.js pins NEAR_DUP_THRESHOLD at the calibrated ${CALIBRATED_THRESHOLD}`, () => {
    // If this fails, the threshold drifted from the operator-reviewed calibration — re-run
    // the sweep (scripts/calibrate-anti-repeat.mjs) and re-confirm the FP rate, don't just edit.
    expect(PROD_COURT_JUDGE_JS).toContain(`NEAR_DUP_THRESHOLD = ${CALIBRATED_THRESHOLD}`);
  });

  it('every labeled near-duplicate pair flags (similarity >= threshold)', () => {
    for (const [a, b] of NEAR_DUP_PAIRS) {
      expect(trigramJaccardSimilarity(a, b)).toBeGreaterThanOrEqual(CALIBRATED_THRESHOLD);
    }
  });

  it('every labeled distinct-but-clever pair passes (< threshold) — no false "heard that one"', () => {
    for (const [a, b] of DISTINCT_PAIRS) {
      expect(trigramJaccardSimilarity(a, b)).toBeLessThan(CALIBRATED_THRESHOLD);
    }
  });
});
