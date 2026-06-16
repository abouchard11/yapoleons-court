import { describe, it, expect } from 'vitest';
import { DEMANDS, selectDailyDemand, type DemandRecord } from './demands';
import { AXES, type Axis } from './judge';

// ── Helpers ──
const sumWeights = (d: DemandRecord): number =>
  AXES.reduce((s, ax) => s + d.axisWeights[ax], 0);

const dominantAxis = (d: DemandRecord): Axis =>
  AXES.reduce((top, ax) => (d.axisWeights[ax] > d.axisWeights[top] ? ax : top), AXES[0]);

// The D-03 buckets (RESEARCH §E). Each bucket is "represented" iff at least one
// record has that axis as its dominant weight AND that weight clears the bucket's
// threshold. Flattery is the CALIBRATION bucket: its dominant weight is capped
// (≈0.30) so naked grovel cannot win on flattery alone — hence its lower
// threshold and the dedicated "grovel must lose" structural assertion below.
const BUCKETS: { axis: Axis; threshold: number; label: string }[] = [
  { axis: 'audacity', threshold: 0.35, label: 'audacity-heavy' },
  { axis: 'economy', threshold: 0.35, label: 'economy-heavy' },
  { axis: 'specificity', threshold: 0.35, label: 'specificity-heavy' },
  { axis: 'flattery', threshold: 0.3, label: 'flattery-calibration' },
  { axis: 'wit', threshold: 0.35, label: 'wit-heavy' },
];

describe('the 30-demand calibration bank (D-01)', () => {
  it('holds exactly 30 records', () => {
    expect(DEMANDS).toHaveLength(30);
  });

  it('gives every record all five canonical axes', () => {
    for (const d of DEMANDS) {
      for (const ax of AXES) {
        expect(typeof d.axisWeights[ax]).toBe('number');
      }
      // No stray axes beyond the canonical five.
      expect(Object.keys(d.axisWeights).sort()).toEqual([...AXES].sort());
    }
  });

  it('makes every axisWeights vector sum to ~1.0 (±0.001)', () => {
    for (const d of DEMANDS) {
      expect(Math.abs(sumWeights(d) - 1)).toBeLessThanOrEqual(0.001);
    }
  });

  it('keeps every weight in [0,1]', () => {
    for (const d of DEMANDS) {
      for (const ax of AXES) {
        expect(d.axisWeights[ax]).toBeGreaterThanOrEqual(0);
        expect(d.axisWeights[ax]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stamps every record with rubricVersion and tier:fairfight (CONT-03)', () => {
    for (const d of DEMANDS) {
      expect(d.rubricVersion).toBe('fairfight-v1');
      expect(d.tier).toBe('fairfight');
    }
  });

  it('uses unique ids', () => {
    const ids = DEMANDS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the golden-path statue demand (the worked-example reference)', () => {
    const statue = DEMANDS.find((d) => d.id === 'wit-statue-golden');
    expect(statue).toBeDefined();
    expect(statue!.scene.toLowerCase()).toContain('statue');
    // The golden path rewards the clever turn → wit must be its dominant axis.
    expect(dominantAxis(statue!)).toBe('wit');
  });
});

describe('D-03 axis-weight bucket coverage (the structural-template defense)', () => {
  for (const { axis, threshold, label } of BUCKETS) {
    it(`represents the ${label} bucket (a record with ${axis} dominant ≥ ${threshold})`, () => {
      const inBucket = DEMANDS.filter(
        (d) => dominantAxis(d) === axis && d.axisWeights[axis] >= threshold,
      );
      expect(inBucket.length).toBeGreaterThan(0);
    });
  }

  it('spreads the bank across all five buckets so no fixed mold wins every day', () => {
    const covered = new Set(
      BUCKETS.filter(({ axis, threshold }) =>
        DEMANDS.some((d) => dominantAxis(d) === axis && d.axisWeights[axis] >= threshold),
      ).map((b) => b.label),
    );
    expect(covered.size).toBe(BUCKETS.length);
  });

  it('caps flattery on the calibration days so NAKED GROVEL must lose (off-axes outweigh flattery)', () => {
    // On every flattery-dominant day, the off-axis weight (everything that is NOT
    // flattery) must STRICTLY EXCEED the flattery weight. A reply that scores high
    // ONLY on flattery therefore captures less than half the weighted band and
    // cannot win — the anti-Suck-Up structural property the design requires.
    const flatteryDays = DEMANDS.filter((d) => dominantAxis(d) === 'flattery');
    expect(flatteryDays.length).toBeGreaterThan(0);
    for (const d of flatteryDays) {
      const offAxis = 1 - d.axisWeights.flattery;
      expect(offAxis).toBeGreaterThan(d.axisWeights.flattery);
      // And flattery is genuinely weighted (not a floor) so it still matters.
      expect(d.axisWeights.flattery).toBeGreaterThanOrEqual(0.25);
    }
  });
});

describe('selectDailyDemand — deterministic daily selection (CONT-02 / JUDGE-02)', () => {
  it('returns the identical record for the same day across repeated calls', () => {
    for (const day of [1, 7, 42, 365, 1000]) {
      const a = selectDailyDemand(day);
      const b = selectDailyDemand(day);
      expect(a).toBe(b); // same object reference → byte-identical for everyone that day
      expect(a.id).toBe(b.id);
    }
  });

  it('always returns a real record from the bank', () => {
    for (let day = 1; day <= 120; day++) {
      const d = selectDailyDemand(day);
      expect(DEMANDS).toContain(d);
    }
  });

  it('walks more than one demand across consecutive days (the shuffle is doing work)', () => {
    const picked = new Set<string>();
    for (let day = 1; day <= 30; day++) picked.add(selectDailyDemand(day).id);
    // Not a guarantee of full coverage, but the select must not be a constant.
    expect(picked.size).toBeGreaterThan(1);
  });
});
