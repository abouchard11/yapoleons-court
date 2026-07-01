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
import { MAX_TURNS } from './config';   // LOOP-02 hard cap — VAL-04 config flag (value stays 3)
import type { JudgeResult } from './judge';

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

// The court_rounds row shape returned by /api/court-can-play (existingRound).
// Only the fields the client needs to reconstruct a finished, read-only state.
export interface ServerRoundRow {
  player_id?: string;
  day: number;
  rubric_version?: string;
  outcome: 'in_progress' | 'won' | 'lost';
  turns_used: number;
  final_favor: number;
}

// The result of /api/court-can-play: the server's verdict on replay eligibility.
//   allowed:false + a terminal existingRound  → render the completed round read-only.
//   allowed:true                              → the player may play (restore cache or fresh).
export interface CanPlayResult {
  allowed: boolean;
  existingRound: ServerRoundRow | null;
}

// What the client reports to /api/court-record-round after each applied turn.
export interface RoundReport {
  rubric_version: string;
  turns_used: number;
  final_favor: number;
  outcome: 'in_progress' | 'won' | 'lost';
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

// What the client reports to the server after a turn — derived purely from the
// (server-delta-driven) client state, so the report and the rendered meter agree.
// outcome maps the client status union onto the court_rounds CHECK constraint
// ('in_progress' | 'won' | 'lost').
export const reportPayload = (s: RoundState, rubricVersion: string): RoundReport => ({
  rubric_version: rubricVersion,
  turns_used: s.turns.length,
  final_favor: s.favor,
  outcome: s.status === 'playing' ? 'in_progress' : s.status,
});

// One per-turn transcript record sent to /api/court-record-round (MEM-02). The
// server persists these verbatim into court_turns (the extractive source of truth)
// and, on a terminal round, summarizes the dossier from them.
export interface TurnRecord {
  turn_index: number;
  reply: string;
  reaction: string;
  favor_delta: number;
  dominant_axis: string;
}

// Project the live turns[] into the per-turn transcript — a trivial map over the
// existing RoundState (NO schema change). reply rides verbatim (the quote source);
// reaction/favor_delta/dominant_axis are the judge's recorded result for that turn.
export const transcriptPayload = (s: RoundState): TurnRecord[] =>
  s.turns.map((t, i) => ({
    turn_index: i,
    reply: t.reply,
    reaction: t.result.reaction,
    favor_delta: t.result.favorDelta,
    dominant_axis: t.result.dominantAxis,
  }));

// ── Server-authoritative replay-aware load (LOOP-05 / D-04) ──────────────────
//
// roundFromServer: reconstruct a FINISHED, read-only RoundState from a court_rounds
// row. A terminal row (won/lost) is the replay lock made visible — the player sees
// their completed round, not a fresh one, EVEN after clearing local storage (the
// server row keyed by UNIQUE(player_id, day) is authoritative). Returns null for an
// in_progress row or no row (those are not terminal/read-only states).
//
// The reconstructed turns array is length-only (we do not persist the per-turn
// reply/reaction on the server in P1 — only turns_used/final_favor/outcome), filled
// with placeholder turns so turns.length === turns_used. The EndState reads
// status + favor + turns.length; the per-turn reaction history is not needed once
// the round is closed (the share/dismissal card is Phase 2).
export const roundFromServer = (day: number, row: ServerRoundRow | null): RoundState | null => {
  if (!row || (row.outcome !== 'won' && row.outcome !== 'lost')) return null;
  const favor = Math.max(FLOOR_FAVOR, Math.min(WIN_FAVOR, Math.round(Number(row.final_favor) || 0)));
  const count = Math.max(0, Math.min(MAX_TURNS, Math.round(Number(row.turns_used) || 0)));
  const turns: RoundTurn[] = Array.from({ length: count }, () => ({
    reply: '',
    result: { axisScores: { wit: 0, specificity: 0, audacity: 0, economy: 0, flattery: 0 }, favorDelta: 0, dominantAxis: 'wit', reaction: '' },
  }));
  return { day, turns, favor, status: row.outcome };
};

// resolveLoadedRound: the single source of truth for "what round do we render on
// mount?" — the SERVER decides eligibility (LOOP-05). Precedence:
//   1. A terminal server round (allowed:false + won/lost row) → read-only completed.
//      This overrides ANY local cache (a cleared OR an in-progress local cache
//      cannot unlock a replay — the headline P1 attack T-01-18).
//   2. Otherwise, the local instant-restore cache for the day (resume in-progress).
//   3. Otherwise, a fresh round.
export const resolveLoadedRound = (day: number, canPlay: CanPlayResult): RoundState => {
  const serverFinished = roundFromServer(day, canPlay.existingRound);
  if (serverFinished) return serverFinished;       // server wins — replay blocked
  const cached = loadRound(day);
  if (cached) return cached;                        // resume the in-progress cache
  return freshRound(day);                           // fresh
};

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
