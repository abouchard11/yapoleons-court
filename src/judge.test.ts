import { describe, it, expect } from 'vitest';
import { AXES, deriveFavorDelta, type Axis } from './judge';

// Helper: build an axisScores record where every axis has the same value.
const uniform = (v: number): Record<Axis, number> =>
  Object.fromEntries(AXES.map((ax) => [ax, v])) as Record<Axis, number>;

// Helper: an even weight vector that sums to 1.0 across the 5 axes.
const evenWeights = (): Record<Axis, number> =>
  Object.fromEntries(AXES.map((ax) => [ax, 1 / AXES.length])) as Record<Axis, number>;

describe('deriveFavorDelta — the server-owned favor math (JUDGE-03)', () => {
  it('returns -28 when every weighted axis score is 0 (worst turn = floor of the band)', () => {
    // weighted = Σ 0 * w = 0  →  mapToBand(0) = -28 (fairfight-v1, calibrated 01-06)
    expect(deriveFavorDelta(uniform(0), evenWeights())).toBe(-28);
  });

  it('returns +52 when the weighted axis score is 1 (best turn = top of the band)', () => {
    // weighted = Σ 1 * w = 1 (weights sum to 1)  →  mapToBand(1) = +52 (fairfight-v1)
    expect(deriveFavorDelta(uniform(1), evenWeights())).toBe(52);
  });

  it('is a pure function of axisScores + dayWeights (same inputs → same output every call)', () => {
    const scores = uniform(0.5);
    const weights = evenWeights();
    const first = deriveFavorDelta(scores, weights);
    const second = deriveFavorDelta(scores, weights);
    const third = deriveFavorDelta(scores, weights);
    expect(first).toBe(second);
    expect(second).toBe(third);
    // And it does not mutate its inputs.
    expect(scores).toEqual(uniform(0.5));
    expect(weights).toEqual(evenWeights());
  });

  it('clamps axis scores outside [0,1] before weighting (a model returning 1.4 is treated as 1)', () => {
    // A model emitting 1.4 on every axis must be treated identically to 1.0 → +52.
    const overshoot = uniform(1.4);
    expect(deriveFavorDelta(overshoot, evenWeights())).toBe(52);
    // A model emitting a negative score must be treated as 0 → -28.
    const undershoot = uniform(-0.3);
    expect(deriveFavorDelta(undershoot, evenWeights())).toBe(-28);
  });

  it('weights matter: a reply scoring high ONLY off-axis yields a smaller delta than one scoring high on the emphasized axis (D-03 structural defense)', () => {
    // A demand that emphasizes 'audacity'. Off-axes sit at a floor.
    const audacityHeavy: Record<Axis, number> = {
      wit: 0.05,
      specificity: 0.05,
      audacity: 0.8,
      economy: 0.05,
      flattery: 0.05,
    };

    // Reply A: high ONLY on the emphasized axis (audacity), nothing elsewhere.
    const onAxis: Record<Axis, number> = {
      wit: 0,
      specificity: 0,
      audacity: 1,
      economy: 0,
      flattery: 0,
    };

    // Reply B: high ONLY on an off-axis (wit), nothing on audacity.
    const offAxis: Record<Axis, number> = {
      wit: 1,
      specificity: 0,
      audacity: 0,
      economy: 0,
      flattery: 0,
    };

    const onAxisDelta = deriveFavorDelta(onAxis, audacityHeavy);
    const offAxisDelta = deriveFavorDelta(offAxis, audacityHeavy);

    // The on-axis reply must earn a strictly larger delta — the day's weight is
    // load-bearing, not cosmetic. (audacity weight 0.8 >> wit weight 0.05.)
    expect(onAxisDelta).toBeGreaterThan(offAxisDelta);
  });
});
