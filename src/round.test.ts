import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyTurn,
  freshRound,
  roundFromServer,
  resolveLoadedRound,
  reportPayload,
  saveRound,
  loadRound,
  type RoundState,
  type ServerRoundRow,
} from './round';
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

// ── Task 1: server-authoritative replay-aware load (LOOP-05 / D-04) ──────────
//
// court-can-play returns { allowed, existingRound }. A FINISHED server row
// (won/lost) must load as a completed, READ-ONLY state — never a fresh playable
// round — even after the local-storage cache is cleared (the server row, keyed by
// UNIQUE(player_id, day), is authoritative; clearing local state cannot unlock a
// replay).

const serverRow = (overrides: Partial<ServerRoundRow> = {}): ServerRoundRow => ({
  player_id: 'p1',
  day: 1,
  rubric_version: 'fairfight-v0',
  outcome: 'won',
  turns_used: 3,
  final_favor: 100,
  ...overrides,
});

describe('roundFromServer — a finished server round loads read-only (replay blocked)', () => {
  beforeEach(() => _resetForTesting());

  it('maps a WON server row to a finished read-only RoundState', () => {
    const s = roundFromServer(1, serverRow({ outcome: 'won', turns_used: 3, final_favor: 100 }));
    expect(s).not.toBeNull();
    expect(s!.status).toBe('won');
    expect(s!.favor).toBe(100);
    expect(s!.turns).toHaveLength(3);     // turns reconstructed to length turns_used
  });

  it('maps a LOST server row to a finished read-only RoundState', () => {
    const s = roundFromServer(1, serverRow({ outcome: 'lost', turns_used: 3, final_favor: 40 }));
    expect(s).not.toBeNull();
    expect(s!.status).toBe('lost');
    expect(s!.favor).toBe(40);
    expect(s!.turns).toHaveLength(3);
  });

  it('returns null for an in_progress server row (not a terminal/read-only state)', () => {
    expect(roundFromServer(1, serverRow({ outcome: 'in_progress', turns_used: 1, final_favor: 20 }))).toBeNull();
  });

  it('returns null when there is no server row', () => {
    expect(roundFromServer(1, null)).toBeNull();
  });

  it('clamps a server final_favor into [0,100] (defensive against a bad row)', () => {
    expect(roundFromServer(1, serverRow({ outcome: 'lost', final_favor: -5 }))!.favor).toBe(0);
    expect(roundFromServer(1, serverRow({ outcome: 'won', final_favor: 250 }))!.favor).toBe(100);
  });
});

describe('resolveLoadedRound — server is authoritative over the local cache', () => {
  beforeEach(() => _resetForTesting());

  it('a finished server round WINS over a (stale/cleared) local cache → read-only completed', () => {
    // Simulate a cleared local cache (loadRound returns null) but a finished server row.
    const resolved = resolveLoadedRound(1, { allowed: false, existingRound: serverRow({ outcome: 'won', final_favor: 100 }) });
    expect(resolved.status).toBe('won');
    expect(resolved.favor).toBe(100);
  });

  it('a finished server round overrides EVEN an existing local in-progress cache (no replay)', () => {
    // Local cache says the player is mid-round; the server says they already finished today.
    saveRound({ day: 1, turns: [{ reply: 'x', result: result(+10) }], favor: 10, status: 'playing' });
    const resolved = resolveLoadedRound(1, { allowed: false, existingRound: serverRow({ outcome: 'lost', turns_used: 3, final_favor: 30 }) });
    expect(resolved.status).toBe('lost');   // server wins — the local in-progress cache cannot unlock a replay
    expect(resolved.favor).toBe(30);
  });

  it('when allowed:true and a local cache exists, the cached in-progress round is restored', () => {
    saveRound({ day: 1, turns: [{ reply: 'x', result: result(+22) }], favor: 22, status: 'playing' });
    const resolved = resolveLoadedRound(1, { allowed: true, existingRound: null });
    expect(resolved.status).toBe('playing');
    expect(resolved.favor).toBe(22);
  });

  it('when allowed:true and no local cache, a fresh round is started', () => {
    const resolved = resolveLoadedRound(1, { allowed: true, existingRound: null });
    expect(resolved).toEqual({ day: 1, turns: [], favor: 0, status: 'playing' });
  });

  it('a cleared local cache + a fresh-eligible day still yields a fresh round (no crash)', () => {
    // loadRound returns null after a clear; allowed:true with an in_progress server row (not terminal)
    const resolved = resolveLoadedRound(1, { allowed: true, existingRound: serverRow({ outcome: 'in_progress', turns_used: 1, final_favor: 12 }) });
    expect(resolved.status).toBe('playing');
    expect(resolved.turns).toHaveLength(0);  // server in_progress is not replayed client-side in P1; fresh start
  });
});

// ── Task 1: the error path does NOT consume a turn or change favor ───────────
//
// A failed judge call re-issues the SAME turn (RESEARCH §G error row): the round
// state is untouched until applyTurn runs, and applyTurn runs ONLY on a successful
// judge result. Modeled here as pure logic: a failure means "do not call applyTurn"
// → state identical; a subsequent success then applies exactly one turn.

describe('error path — a failed turn consumes no turn and changes no favor', () => {
  beforeEach(() => _resetForTesting());

  it('NOT applying a turn (the failure case) leaves turns.length and favor unchanged', () => {
    const before = startState({ favor: 40, turns: [{ reply: 't1', result: result(+40) }] });
    // On a judge failure the RoundScreen does NOT call applyTurn — the state is the SAME reference.
    const afterFailure = before;
    expect(afterFailure.turns).toHaveLength(1);
    expect(afterFailure.favor).toBe(40);
    expect(afterFailure.status).toBe('playing');
  });

  it('retrying the SAME turn after a failure applies exactly one turn (no double-consume)', () => {
    const before = startState({ favor: 40, turns: [{ reply: 't1', result: result(+40) }] });
    // First attempt failed → no applyTurn. Retry succeeds → exactly one applyTurn for that turn.
    const afterRetry = applyTurn(before, 't2', result(+30));
    expect(afterRetry.turns).toHaveLength(2);        // one turn added, not two
    expect(afterRetry.favor).toBe(70);
    // The pre-retry state was never mutated (the failed attempt left no trace).
    expect(before.turns).toHaveLength(1);
    expect(before.favor).toBe(40);
  });
});

// ── Task 1: server-report consistency ───────────────────────────────────────
//
// What the client reports to court-record-round (turns_used / final_favor /
// outcome) must match the client RoundState after each applied turn.

describe('reportPayload — what is sent to the server matches the client state', () => {
  it('reports turns_used / final_favor / outcome matching the state after a winning turn', () => {
    const s = applyTurn(startState({ favor: 60 }), 'win', result(+50)); // → 100, won
    const payload = reportPayload(s, 'fairfight-v0');
    expect(payload).toEqual({
      rubric_version: 'fairfight-v0',
      turns_used: s.turns.length,
      final_favor: s.favor,
      outcome: 'won',
    });
    expect(payload.turns_used).toBe(1);
    expect(payload.final_favor).toBe(100);
  });

  it('reports outcome "in_progress" while the round is still playing', () => {
    const s = applyTurn(startState(), 't1', result(+10));
    expect(reportPayload(s, 'fairfight-v0').outcome).toBe('in_progress');
  });

  it('reports outcome "lost" and the floored favor after a 3rd-turn dismissal', () => {
    let s = startState();
    s = applyTurn(s, 't1', result(-30)); // floor 0
    s = applyTurn(s, 't2', result(+15)); // 15
    s = applyTurn(s, 't3', result(+10)); // 25, 3rd turn → lost
    const payload = reportPayload(s, 'fairfight-v0');
    expect(payload.outcome).toBe('lost');
    expect(payload.final_favor).toBe(25);
    expect(payload.turns_used).toBe(3);
  });

  it('round-trips through saveRound/loadRound so the persisted state matches the report', () => {
    _resetForTesting();
    let s = startState();
    s = applyTurn(s, 't1', result(+20));
    saveRound(s);
    const restored = loadRound(1);
    expect(restored).not.toBeNull();
    expect(reportPayload(restored!, 'fairfight-v0')).toEqual(reportPayload(s, 'fairfight-v0'));
  });
});
