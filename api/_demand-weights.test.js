// ============================================================================
// Server-owned axis weights (2026-10-23) — the selection MIRROR.
//
// api/_demand-weights.js is the ONE weight table; src/demands.ts reads it by id
// and the server selects from it by day. Both sides must pick the SAME entry for
// the SAME day, or the server would score a reply against a different demand's
// weights than the scene the player saw. This file pins that mirror:
//   * the ids are in the SAME order on both sides (the index math depends on it)
//   * for a wide range of day numbers the selected id is identical
//   * weightsFor(id) is the very vector the TS record carries
//   * every vector is a valid weight vector (the server's normalizeWeights contract)
// ============================================================================

import { describe, it, expect } from 'vitest';
import { DEMAND_WEIGHTS, selectDailyWeights, weightsFor, scramble } from './_demand-weights.js';
import { DEMANDS, selectDailyDemand } from '../src/demands.ts';
import { scramble as tsScramble } from '../src/daily.ts';

const AXES = ['wit', 'specificity', 'audacity', 'economy', 'flattery'];

describe('api/_demand-weights.js mirrors src/demands.ts', () => {
  it('carries the same ids in the same order as DEMANDS (the index math depends on it)', () => {
    expect(DEMAND_WEIGHTS.map((w) => w.id)).toEqual(DEMANDS.map((d) => d.id));
  });

  it('scramble is byte-equivalent to src/daily.ts scramble', () => {
    for (let day = -5; day <= 5000; day++) expect(scramble(day)).toBe(tsScramble(day));
  });

  it('selects the SAME demand id as the client for every day in a wide range', () => {
    for (let day = 1; day <= 3000; day++) {
      expect(selectDailyWeights(day).id).toBe(selectDailyDemand(day).id);
    }
  });

  it('selectDailyWeights(day).axisWeights IS the client record\'s axisWeights for that day', () => {
    for (let day = 1; day <= 400; day++) {
      expect(selectDailyWeights(day).axisWeights).toEqual(selectDailyDemand(day).axisWeights);
    }
  });

  it('weightsFor(id) returns the vector each TS record carries, and throws on an unknown id', () => {
    for (const d of DEMANDS) expect(weightsFor(d.id)).toBe(d.axisWeights);
    expect(() => weightsFor('no-such-demand')).toThrow(/No axis weights/);
  });

  it('every vector has all five axes, non-negative, summing to ~1.0 (the server contract)', () => {
    for (const { axisWeights } of DEMAND_WEIGHTS) {
      expect(Object.keys(axisWeights).sort()).toEqual([...AXES].sort());
      let sum = 0;
      for (const ax of AXES) {
        expect(axisWeights[ax]).toBeGreaterThanOrEqual(0);
        sum += axisWeights[ax];
      }
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.001);
    }
  });
});
