// ============================================================================
// COST-03 — per-DAU math regression (the peak-DAU-divisor bug).
//
// The bug: the window's total tokens/cost were divided by the PEAK single-day DAU
// (Math.max of the per-day distinct-player counts), which understates the
// denominator and OVERSTATES per-DAU. The correct divisor for a window total is
// DAU-DAYS — the SUM of each day's distinct-player count.
//
// computePerDau is the extracted pure helper; these tests pin the corrected divisor
// and the reported method. (Importing the module must NOT run the CLI main() — the
// entry-point guard covers that; if it regressed, this suite would exit early.)
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computePerDau, callCost } from './cost-ledger.mjs';

// A 3-day window: 100 total tokens + 5 calls per day (300 tok / 15 calls total).
const perDay = [
  { day: '2026-07-01', calls: 5, inTok: 0, outTok: 100, thinkTok: 0, totalTok: 100 },
  { day: '2026-06-30', calls: 5, inTok: 0, outTok: 100, thinkTok: 0, totalTok: 100 },
  { day: '2026-06-29', calls: 5, inTok: 0, outTok: 100, thinkTok: 0, totalTok: 100 },
];
// Distinct players per day: 10, 20, 30 → DAU-days = 60, peak-day DAU = 30.
const DAU_DAYS = 60;
const PEAK_DAY_DAU = 30;

describe('COST-03 computePerDau — divides by DAU-days, not peak-day DAU', () => {
  const r = computePerDau(perDay, DAU_DAYS, PEAK_DAY_DAU);

  it('uses DAU-days (Σ distinct players/day) as the divisor', () => {
    expect(r.dau_days).toBe(DAU_DAYS);
    // 300 total tokens ÷ 60 DAU-days = 5.0 (NOT ÷30 peak = 10.0).
    expect(r.tokens_per_dau).toBe(5);
    // 15 total calls ÷ 60 DAU-days = 0.25.
    expect(r.avg_calls_per_dau).toBe(0.25);
  });

  it('does NOT use the peak single-day DAU as the divisor (the fixed bug)', () => {
    const totalTok = 300;
    const buggyPeakDivided = Number((totalTok / PEAK_DAY_DAU).toFixed(1)); // 10.0
    // The corrected number must be strictly smaller than the old overstated one.
    expect(r.tokens_per_dau).toBeLessThan(buggyPeakDivided);
    expect(r.tokens_per_dau).toBe(Number((totalTok / DAU_DAYS).toFixed(1)));
  });

  it('carries peak-day DAU through as a labelled DIAGNOSTIC only (not the divisor)', () => {
    expect(r.peak_day_dau).toBe(PEAK_DAY_DAU);
  });

  it('states the DAU-days denominator method in the output', () => {
    expect(r.denominator_method).toMatch(/DAU-days/);
    expect(r.denominator_method).toMatch(/distinct court_rounds\.player_id per day/);
  });

  it('costs the window at the primary rate and divides by DAU-days', () => {
    // 3 days × 100 output tokens billed at the output rate, ÷ 60 DAU-days.
    const expected = Number(((callCost(0, 100, 0) * 3) / DAU_DAYS).toFixed(6));
    expect(r.cost_per_dau_usd).toBe(expected);
  });

  it('method equivalence: total ÷ DAU-days == DAU-weighted avg of daily (cost ÷ DAU)', () => {
    // Per-day DAU: 10, 20, 30. Daily cost is identical each day (same tokens).
    const dailyCost = callCost(0, 100, 0);
    const dau = [10, 20, 30];
    // DAU-weighted average of (daily cost ÷ daily DAU):
    //   Σ(dau_i * (dailyCost/dau_i)) / Σ(dau_i) = Σ(dailyCost) / Σ(dau_i) = total ÷ DAU-days.
    const weightedAvg = dau.reduce((s, d) => s + d * (dailyCost / d), 0) / dau.reduce((s, d) => s + d, 0);
    expect(Number(weightedAvg.toFixed(6))).toBe(r.cost_per_dau_usd);
  });

  it('guards div-by-zero on an empty window (no NaN / Infinity)', () => {
    const empty = computePerDau([], 0, 0);
    expect(empty.tokens_per_dau).toBe(0);
    expect(empty.cost_per_dau_usd).toBe(0);
    expect(empty.avg_calls_per_dau).toBe(0);
    expect(Number.isFinite(empty.tokens_per_dau)).toBe(true);
  });
});
