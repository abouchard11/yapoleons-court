import { describe, it, expect, beforeEach } from 'vitest';
import { applyTurn, freshRound, type RoundState } from './round';
import { _resetForTesting } from './storage-adapter';
import type { Axis, JudgeResult } from './judge';

// Build a JudgeResult with a given favorDelta (axisScores are not load-bearing
// for the round state machine — the server already derived the delta).
const result = (favorDelta: number, reaction = 'A reaction.'): JudgeResult => ({
  axisScores: { wit: 0, specificity: 0, audacity: 0, economy: 0, flattery: 0 } as Record<Axis, number>,
  favorDelta,
  dominantAxis: 'wit',
  reaction,
});

const startState = (overrides: Partial<RoundState> = {}): RoundState => ({
  day: 1,
  turns: [],
  favor: 0,
  status: 'playing',
  ...overrides,
});

describe('applyTurn — the round state machine (LOOP/METER)', () => {
  beforeEach(() => _resetForTesting());

  it('floors favor at 0: a -10 delta from favor 0 stays at 0 (never negative — METER-02)', () => {
    const s = applyTurn(startState({ favor: 0 }), 'a weak reply', result(-10));
    expect(s.favor).toBe(0);
    expect(s.favor).toBeGreaterThanOrEqual(0);
  });

  it('caps favor at 100: a +54 delta from favor 46 reaches 100 (LOOP-03)', () => {
    const s = applyTurn(startState({ favor: 46, turns: [
      { reply: 't1', result: result(-10) },
      { reply: 't2', result: result(+46) },
    ] }), 'a strong reply', result(+54));
    expect(s.favor).toBe(100);
  });

  it('reaching favor 100 sets status "won" (LOOP-03)', () => {
    const s = applyTurn(startState({ favor: 60 }), 'a winning reply', result(+50));
    expect(s.favor).toBe(100);
    expect(s.status).toBe('won');
  });

  it('the 3rd turn ending below 100 sets status "lost" (LOOP-04)', () => {
    let s = startState();
    s = applyTurn(s, 't1', result(+10)); // favor 10, playing
    expect(s.status).toBe('playing');
    s = applyTurn(s, 't2', result(+10)); // favor 20, playing
    expect(s.status).toBe('playing');
    s = applyTurn(s, 't3', result(+10)); // favor 30, 3rd turn < 100 → lost
    expect(s.favor).toBe(30);
    expect(s.status).toBe('lost');
    expect(s.turns).toHaveLength(3);
  });

  it('a round never exceeds 3 turns: applyTurn after a finished round is a no-op (LOOP-02)', () => {
    let s = startState();
    s = applyTurn(s, 't1', result(+10));
    s = applyTurn(s, 't2', result(+10));
    s = applyTurn(s, 't3', result(+10)); // now lost, 3 turns
    const after = applyTurn(s, 't4', result(+50)); // must NOT accept a 4th turn
    expect(after.turns).toHaveLength(3);
    expect(after.favor).toBe(s.favor);
    expect(after.status).toBe('lost');
  });

  it('the golden-path arc works: -10→0, +46→46, +54→100 (won in 3)', () => {
    let s = startState();
    s = applyTurn(s, 'turn one', result(-10));   // 0 - 10 → clamp 0
    expect(s.favor).toBe(0);
    expect(s.status).toBe('playing');
    s = applyTurn(s, 'turn two', result(+46));    // 0 + 46 → 46
    expect(s.favor).toBe(46);
    expect(s.status).toBe('playing');
    s = applyTurn(s, 'turn three', result(+54));  // 46 + 54 → 100 → won
    expect(s.favor).toBe(100);
    expect(s.status).toBe('won');
    expect(s.turns).toHaveLength(3);
  });

  it('does not mutate the input state (returns a new object)', () => {
    const s = startState({ favor: 20 });
    const next = applyTurn(s, 'reply', result(+10));
    expect(s.favor).toBe(20);          // original unchanged
    expect(s.turns).toHaveLength(0);   // original unchanged
    expect(next).not.toBe(s);
  });
});

describe('freshRound', () => {
  it('starts a fresh round at favor 0, no turns, playing', () => {
    const s = freshRound(7);
    expect(s).toEqual({ day: 7, turns: [], favor: 0, status: 'playing' });
  });
});
