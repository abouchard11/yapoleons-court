// ─────────────────────────────────────────────────────────────────────
//  The round state machine (LOOP-01..05, METER-01/02/03)
// ─────────────────────────────────────────────────────────────────────
// Forked from the source engine's DailyState shape + loadDaily/saveDaily via
// StorageAdapter (PATTERNS "src/round.ts"). The board/guesses model is replaced
// by the favor round: turns of { reply, JudgeResult }, a 0..100 favor meter, and
// the won/lost transitions (RESEARCH §G).
//
// The SERVER's UNIQUE(player_id, day) row is authoritative for replay eligibility
// (LOOP-05); this client RoundState is an instant-restore cache only (court.round.v1).

import { StorageAdapter } from './storage-adapter';
import type { JudgeResult } from './judge';

const MAX_TURNS = 3;     // LOOP-02 hard cap
const WIN_FAVOR = 100;   // LOOP-03 concession threshold
const FLOOR_FAVOR = 0;   // METER-02 floor (never renders negative)

const ROUND_KEY = 'court.round.v1';

export interface RoundTurn {
  reply: string;
  result: JudgeResult;
}

export interface RoundState {
  day: number;
  turns: RoundTurn[];                  // ≤3
  favor: number;                       // 0..100
  status: 'playing' | 'won' | 'lost';
}

// A brand-new round for the given day.
export const freshRound = (day: number): RoundState => ({
  day,
  turns: [],
  favor: FLOOR_FAVOR,
  status: 'playing',
});

// Apply one judged turn. Pure: returns a NEW state, never mutates the input.
//   favor  = clamp(favor + favorDelta) to [0,100]  (floor METER-02, cap LOOP-03)
//   status = won at 100, else lost on the 3rd turn below 100, else playing
// A turn applied to an already-finished round (won/lost, or 3 turns used) is a
// no-op (LOOP-02 — no 4th turn is ever accepted).
export const applyTurn = (s: RoundState, reply: string, result: JudgeResult): RoundState => {
  if (s.status !== 'playing' || s.turns.length >= MAX_TURNS) {
    return s;
  }
  const favor = Math.max(FLOOR_FAVOR, Math.min(WIN_FAVOR, s.favor + result.favorDelta));
  const turns = [...s.turns, { reply, result }];
  const status: RoundState['status'] =
    favor >= WIN_FAVOR ? 'won' : turns.length >= MAX_TURNS ? 'lost' : 'playing';
  return { ...s, favor, turns, status };
};

// True once the round is over (concession or dismissal).
export const isFinished = (s: RoundState): boolean => s.status !== 'playing';

// Turns remaining before the hard cap.
export const turnsRemaining = (s: RoundState): number => Math.max(0, MAX_TURNS - s.turns.length);

export const ROUND_LIMITS = { MAX_TURNS, WIN_FAVOR, FLOOR_FAVOR } as const;

// ── Persistence (instant-restore cache; the server is authoritative for replay) ──

export const loadRound = (day: number): RoundState | null => {
  try {
    const raw = StorageAdapter.getItem(ROUND_KEY);
    if (raw) {
      const d = JSON.parse(raw) as RoundState;
      if (d && d.day === day && Array.isArray(d.turns)) return d;
    }
  } catch { /* ignore — restore is best-effort */ }
  return null;
};

export const saveRound = (s: RoundState): void => {
  StorageAdapter.setItem(ROUND_KEY, JSON.stringify(s));
};
