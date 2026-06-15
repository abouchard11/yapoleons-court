// The thinnest round container (the Walking Skeleton's one real screen). A FRESH
// hand-rolled build against the UI-SPEC — NOT a strip of any prior game shell
// (RESEARCH Pitfall 4). It lays out demand → meter → reaction → input → CTA on the
// cream notebook canvas and wires the real loop:
//   ensureIdentity() (01-01) → selectDailyDemand(getDayNumber()) → on submit:
//   pending → judgeReply() (real Gemini, server-derived delta) → record the round
//   (court-record-round) → applyTurn → reveal reaction + animate meter → win/lose
//   or next turn.
//
// DEFERRED to Plan 01-05 (per the plan): the full EndState (gold/crimson takeover)
// + ErrorState components, TurnIndicator polish, prefers-reduced-motion in every
// surface, and full state-machine restore. The skeleton ships demand→reply→
// meter-moves→(simple win/lose text)→error-retry working end-to-end.

import { useEffect, useRef, useState } from 'react';
import DemandFraming from './components/DemandFraming';
import FavorMeter from './components/FavorMeter';
import ReplyInput from './components/ReplyInput';
import SubmitButton from './components/SubmitButton';
import PendingIndicator from './components/PendingIndicator';
import ReactionLine from './components/ReactionLine';
import { ensureIdentity, apiFetch } from './court-identity';
import { selectDailyDemand, type DemandRecord } from './demands';
import { getDayNumber } from './daily';
import { judgeReply } from './gemini-client';
import { applyTurn, freshRound, loadRound, saveRound, turnsRemaining, type RoundState } from './round';

type Phase = 'fresh' | 'pending' | 'revealed' | 'error';

export default function RoundScreen() {
  const [demand, setDemand] = useState<DemandRecord | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [reply, setReply] = useState('');
  const [phase, setPhase] = useState<Phase>('fresh');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const identityReady = useRef(false);

  // On mount: mint/reuse the anon identity (01-01) and select today's demand.
  useEffect(() => {
    const day = getDayNumber();
    const d = selectDailyDemand(day);
    setDemand(d);
    const restored = loadRound(day);
    setRound(restored ?? freshRound(day));
    void ensureIdentity()
      .then(() => { identityReady.current = true; })
      .catch(() => { /* identity mint failure surfaces on the first record write */ });
  }, []);

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
  const canSubmit = phase !== 'pending' && !finished && reply.trim().length > 0;

  async function handleSubmit() {
    if (!demand || !round || !canSubmit) return;
    const submittedReply = reply.trim();
    setPhase('pending');
    setErrorMsg(null);
    try {
      // Ensure identity exists before the authed record write.
      if (!identityReady.current) {
        await ensureIdentity();
        identityReady.current = true;
      }

      // ONE structured judge call → server-derived favorDelta.
      const result = await judgeReply(demand, submittedReply);

      // Advance the round state machine (clamp + win/lose transitions).
      const next = applyTurn(round, submittedReply, result);

      // Record the round server-side (idempotent start + progress/outcome update).
      // Best-effort: a record failure must not block the reveal (the judge already ran).
      try {
        await apiFetch('/api/court-record-round', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rubric_version: demand.rubricVersion,
            turns_used: next.turns.length,
            final_favor: next.favor,
          }),
        });
      } catch { /* the meter still moves; replay-lock is server-authoritative */ }

      setRound(next);
      saveRound(next);
      setReply('');
      setPhase('revealed');
    } catch {
      // Judge call failed — degrade to the error state. NO turn consumed, NO favor
      // change (the round state is untouched), so "Try Again" re-issues the same turn.
      setErrorMsg('The Emperor has turned away — for the moment. Even an Emperor\'s attention wanders. Try once more.');
      setPhase('error');
    }
  }

  return (
    <div className="game-container">
      <main style={mainStyle}>
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '32rem' }}>
          {/* Tertiary: the day's framed demand */}
          <DemandFraming sceneText={demand.scene} />

          {/* Primary anchor: meter + reaction working together */}
          <FavorMeter favor={round.favor} lastDelta={lastDelta} animating={phase === 'revealed'} />

          {phase === 'revealed' && lastReaction && (
            <ReactionLine reaction={lastReaction} delta={lastDelta} />
          )}

          <PendingIndicator visible={phase === 'pending'} />

          {/* Simple end-state text (the full gold/crimson takeover is Plan 01-05) */}
          {round.status === 'won' && (
            <div>
              <p style={endLineStyle}>Yapoleon inclines his head. You have his favor — for today.</p>
              <p style={subLineStyle}>Favor won in {round.turns.length}.</p>
            </div>
          )}
          {round.status === 'lost' && (
            <p style={{ ...endLineStyle, color: 'var(--yap-crimson)' }}>
              The Emperor has heard enough. You are dismissed.
            </p>
          )}

          {/* Error state (basic; full ErrorState component is Plan 01-05) */}
          {phase === 'error' && errorMsg && (
            <div role="alert">
              <p style={{ ...subLineStyle, color: 'var(--yap-crimson)' }}>{errorMsg}</p>
              <SubmitButton onClick={handleSubmit} disabled={reply.trim().length === 0} />
            </div>
          )}

          {/* Input + CTA — only while the round is still playable */}
          {!finished && phase !== 'error' && (
            <>
              <ReplyInput value={reply} onChange={setReply} disabled={phase === 'pending'} />
              <SubmitButton onClick={handleSubmit} disabled={!canSubmit} />
              <p style={turnCounterStyle}>
                Turn {round.turns.length + 1} of 3 · {turnsRemaining(round)} remaining
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

const endLineStyle: React.CSSProperties = {
  fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
  fontSize: '28px',
  fontWeight: 700,
  lineHeight: 1.2,
  color: 'var(--yap-navy)',
  margin: 0,
};

const subLineStyle: React.CSSProperties = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '16px',
  color: 'var(--yap-navy)',
  marginTop: '8px',
  marginBottom: 0,
};

const turnCounterStyle: React.CSSProperties = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '14px',
  color: 'rgba(27, 42, 74, 0.6)',
  margin: 0,
  textAlign: 'center',
};
