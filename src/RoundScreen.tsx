// The round container — the full UI-SPEC state machine (Plan 01-05). A FRESH
// hand-rolled build against the UI-SPEC (NOT a strip of any prior game shell —
// RESEARCH Pitfall 4). It lays out demand → meter+turns → reaction → input → CTA on
// the cream notebook canvas and runs the complete loop:
//
//   on mount: ensureIdentity() (01-01) → /api/court-can-play (replay check, Task 1)
//             → resolveLoadedRound(day, canPlay) → selectDailyDemand(getDayNumber())
//   on submit: pending → judgeReply() (one real Gemini call, server-derived delta)
//              → applyTurn → record-round (reportPayload) → reveal + animate meter
//              → won / lost / next turn
//   on judge failure: error state + "Try Again" that re-issues the SAME turn —
//                     NO turn consumed, NO favor change (Task 1 error path).
//
// Replay lock (LOOP-05 / D-04): if court-can-play returns a finished round
// (allowed:false), resolveLoadedRound surfaces it READ-ONLY — the server row is
// authoritative, so clearing local storage cannot unlock a replay (T-01-18).

import { useEffect, useRef, useState } from 'react';
import DemandFraming from './components/DemandFraming';
import FavorMeter from './components/FavorMeter';
import TurnIndicator from './components/TurnIndicator';
import ReplyInput from './components/ReplyInput';
import SubmitButton from './components/SubmitButton';
import PendingIndicator from './components/PendingIndicator';
import ReactionLine from './components/ReactionLine';
import EndState from './components/EndState';
import ErrorState from './components/ErrorState';
import { ensureIdentity, apiFetch } from './court-identity';
import { selectDailyDemand, type DemandRecord } from './demands';
import { getDayNumber } from './daily';
import { judgeReply } from './gemini-client';
import {
  applyTurn,
  freshRound,
  resolveLoadedRound,
  reportPayload,
  saveRound,
  turnsRemaining,
  type RoundState,
  type CanPlayResult,
} from './round';

// The submit/UI phase OVER the round state. The round's own status (playing/won/
// lost) is the durable truth; `uiPhase` tracks the transient in-flight/reveal/error
// beats that are not persisted.
type UiPhase = 'idle' | 'pending' | 'revealed' | 'error';

// Static in-voice fallback for an end-state with no live judge reaction available
// (a server-loaded, replay-blocked round — the per-turn reactions are not persisted
// server-side in P1). On a freshly-played round the real judge reaction is used.
const FALLBACK_END_LINE: Record<'won' | 'lost', string> = {
  won: 'You won the Emperor\'s favor today. He will pretend he saw it coming.',
  lost: 'The Emperor has already turned to other amusements. The audience is over.',
};

export default function RoundScreen() {
  const [demand, setDemand] = useState<DemandRecord | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [reply, setReply] = useState('');
  const [uiPhase, setUiPhase] = useState<UiPhase>('idle');
  const identityReady = useRef(false);

  // On mount: mint/reuse the anon identity (01-01), ask the server whether the day
  // is still playable (replay check), then resolve the round (server-authoritative).
  useEffect(() => {
    let cancelled = false;
    const day = getDayNumber();
    setDemand(selectDailyDemand(day));

    (async () => {
      let canPlay: CanPlayResult = { allowed: true, existingRound: null };
      try {
        await ensureIdentity();
        identityReady.current = true;
        const res = await apiFetch('/api/court-can-play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          canPlay = {
            allowed: data.allowed !== false,
            existingRound: data.existingRound ?? null,
          };
        }
      } catch {
        // Offline / identity-mint failure: fall back to the local cache (best-effort).
        // The server remains authoritative the next time it is reachable; a forged
        // replay still cannot be RECORDED (court-record-round enforces UNIQUE).
      }
      if (cancelled) return;
      setRound(resolveLoadedRound(day, canPlay));
    })();

    return () => { cancelled = true; };
  }, []);

  // First paint, before the round resolves: the "considers…" beat as a load veil.
  if (!demand || !round) {
    return (
      <div className="game-container">
        <main style={mainStyle}>
          <PendingIndicator visible />
        </main>
      </div>
    );
  }

  const lastTurn = round.turns[round.turns.length - 1];
  const lastDelta = lastTurn?.result.favorDelta;
  const lastReaction = lastTurn?.result.reaction ?? '';
  const finished = round.status !== 'playing';
  const canSubmit = uiPhase !== 'pending' && !finished && reply.trim().length > 0;

  // The end-state line: the live judge's final reaction if present (a freshly-played
  // round), else the static in-voice fallback (a server-loaded replay-blocked round).
  const endLine = (outcome: 'won' | 'lost'): string =>
    lastReaction || FALLBACK_END_LINE[outcome];

  // submitTurn judges the CURRENT reply and, on success, applies exactly one turn.
  // On failure it leaves the round untouched (no turn consumed) and enters `error`,
  // so "Try Again" re-issues the SAME turn. Used by both the CTA and the retry.
  async function submitTurn(text: string) {
    if (!demand || !round) return;
    setUiPhase('pending');
    try {
      if (!identityReady.current) {
        await ensureIdentity();
        identityReady.current = true;
      }

      // ONE structured judge call → server-derived favorDelta.
      const result = await judgeReply(demand, text);

      // Advance the round state machine (clamp + win/lose transitions).
      const next = applyTurn(round, text, result);

      // Record the round server-side (idempotent start + progress/outcome update).
      // Best-effort: a record failure must not block the reveal (the judge already
      // ran). The reported payload is derived purely from `next` so it matches the
      // rendered meter exactly (server-report consistency, Task 1).
      try {
        await apiFetch('/api/court-record-round', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reportPayload(next, demand.rubricVersion)),
        });
      } catch { /* the meter still moves; the replay-lock row is server-authoritative */ }

      setRound(next);
      saveRound(next);
      setReply('');
      setUiPhase('revealed');
    } catch {
      // Judge call failed → error state. The round is UNCHANGED (no applyTurn ran),
      // so the turn was not consumed and the favor did not move. "Try Again"
      // re-issues this same turn with the reply still intact.
      setUiPhase('error');
    }
  }

  const handleSubmit = () => { if (canSubmit) void submitTurn(reply.trim()); };
  // Retry re-issues the SAME turn: the reply is still in state (it is only cleared on
  // a SUCCESSFUL turn), so we re-judge the current reply without advancing anything.
  const handleRetry = () => { if (reply.trim().length > 0) void submitTurn(reply.trim()); };

  return (
    <div className="game-container">
      <main style={mainStyle}>
        <section style={columnStyle}>
          {/* Tertiary: the day's framed demand (read once, then recedes). */}
          <DemandFraming sceneText={demand.scene} />

          {/* Primary anchor: meter + reaction working together. */}
          <FavorMeter
            favor={round.favor}
            lastDelta={lastDelta}
            animating={uiPhase === 'revealed'}
          />

          {/* The screenshot beat — only while the round is still open (mid-round). */}
          {uiPhase === 'revealed' && !finished && lastReaction && (
            <ReactionLine reaction={lastReaction} delta={lastDelta} />
          )}

          {/* Pending: "Yapoleon considers…" (the deliberation beat). */}
          <PendingIndicator visible={uiPhase === 'pending'} />

          {/* WON / LOST takeover (read-only — whether freshly played or replay-blocked). */}
          {round.status === 'won' && (
            <EndState outcome="won" line={endLine('won')} turnsUsed={round.turns.length} />
          )}
          {round.status === 'lost' && (
            <EndState outcome="lost" line={endLine('lost')} turnsUsed={round.turns.length} />
          )}

          {/* ERROR: a failed judge call — "Try Again" re-issues the same turn. */}
          {uiPhase === 'error' && !finished && (
            <ErrorState onRetry={handleRetry} />
          )}

          {/* Input + CTA + turn counter — only while the round is still playable and
              not currently in the error state (the error state owns the retry). */}
          {!finished && uiPhase !== 'error' && (
            <>
              <ReplyInput value={reply} onChange={setReply} disabled={uiPhase === 'pending'} />
              <SubmitButton onClick={handleSubmit} disabled={!canSubmit} />
              <TurnIndicator turnsUsed={round.turns.length} turnsTotal={3} />
              <p style={remainingHintStyle}>
                {turnsRemaining(round)} {turnsRemaining(round) === 1 ? 'turn' : 'turns'} remaining
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  width: '100%',
};

const columnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  width: '100%',
  maxWidth: '32rem',
};

const remainingHintStyle: React.CSSProperties = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '14px',
  color: 'rgba(27, 42, 74, 0.6)',
  margin: 0,
  textAlign: 'center',
};
