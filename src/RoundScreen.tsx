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
import GreetingMoment from './components/GreetingMoment';
import { fetchGreeting, type GreetingPayload } from './court-dossier';
import { ensureIdentity, apiFetch } from './court-identity';
import { selectDailyDemand, type DemandRecord } from './demands';
import { getDayNumber } from './daily';
import { judgeReply } from './gemini-client';
import {
  applyTurn,
  freshRound,
  resolveLoadedRound,
  reportPayload,
  transcriptPayload,
  saveRound,
  turnsRemaining,
  type RoundState,
  type CanPlayResult,
} from './round';
import { shareVerdict, buildVerdictShareParts, type VerdictCardData } from './share';

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

  // 02-06 share state. winStreak (D-03) comes from /api/court-can-play on mount and
  // feeds the card's standing slot. sharePending guards the CTA while drawing. cardError
  // flips the EndState CTA over to the "portraitist faltered" retry. toast announces the
  // desktop "Card saved!" path (aria-live polite).
  const [winStreak, setWinStreak] = useState(0);
  const [sharePending, setSharePending] = useState(false);
  const [cardError, setCardError] = useState(false);
  const [toast, setToast] = useState('');

  // 03-02 greeting (MEM-01) — a pre-round prelude beat. `greeting` is null until the
  // grounded greeting resolves (or stays null on a cold-start/failure → no beat).
  // `greetingDismissed` flips on continue; once dismissed the existing round flow runs.
  const [greeting, setGreeting] = useState<GreetingPayload | null>(null);
  const [greetingDismissed, setGreetingDismissed] = useState(false);

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
          // winStreak (D-03) is additive on the can-play response; hold it for the card.
          if (!cancelled && typeof data.winStreak === 'number') {
            setWinStreak(data.winStreak);
          }
        }
      } catch {
        // Offline / identity-mint failure: fall back to the local cache (best-effort).
        // The server remains authoritative the next time it is reachable; a forged
        // replay still cannot be RECORDED (court-record-round enforces UNIQUE).
      }
      if (cancelled) return;
      const resolved = resolveLoadedRound(day, canPlay);
      setRound(resolved);

      // The greeting (MEM-01) is a pure prelude — fetched ONCE, and ONLY for a fresh
      // playable round (never on a replay-blocked re-open or a resumed mid-round, which
      // would waste a model call). fetchGreeting resolves to null on a cold-start /
      // non-200 / offline → no beat: the round opens exactly as it does today.
      if (resolved.status === 'playing' && resolved.turns.length === 0) {
        const g = await fetchGreeting();
        if (!cancelled && g) setGreeting(g);
      }
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

  // ── Fresh-play gate (02-06 / T-02-16, Pitfall 1) ──────────────────────────────
  // roundFromServer (round.ts:120-123) reconstructs a replay-blocked round with
  // PLACEHOLDER turns: reply:'' + result.reaction:''. A card built from those would
  // carry BLANK quotes. The resolved scope is FRESH-PLAY-ONLY: a card is only ever
  // produced when the last turn carries a real reply (a freshly-played round). On a
  // replay-blocked re-open this is false, so no onShare is passed and the CTA is
  // omitted (degrade, never a blank-quote card).
  const isFreshPlay = finished && (lastTurn?.reply ?? '') !== '';

  // 02-06 — assemble the live card payload and fire the web-first share cascade.
  // heroLine: the player's winning reply on a win (the brag) / the savage dismissal
  // line on a loss. concessionLine: the judge's final reaction (WIN only). Everything
  // is read from the LIVE RoundState + the captured winStreak; no second model call.
  async function handleShare(outcome: 'won' | 'lost') {
    if (!demand || !round) return;
    const last = round.turns[round.turns.length - 1];
    if (!last) return; // defensive — only reachable on a freshly-played finished round

    const data: VerdictCardData = {
      outcome,
      demandScene: demand.scene,
      heroLine: outcome === 'won' ? last.reply : last.result.reaction,
      concessionLine: outcome === 'won' ? last.result.reaction : undefined,
      turnsUsed: round.turns.length,
      tierLabel: 'Fair Fight',
      winStreak,
    };

    setCardError(false);
    setSharePending(true);
    try {
      await shareVerdict(data, buildVerdictShareParts(outcome), showToast, round.day);
    } catch {
      // drawVerdictCard / canvas failure → the in-voice card-error state ("The
      // Emperor's portraitist faltered.") with a Try Again that re-attempts the draw.
      // A user-cancel of the OS sheet is swallowed inside shareVerdict (not here).
      setCardError(true);
    } finally {
      setSharePending(false);
    }
  }

  // Toast helper (desktop "Card saved!" path; aria-live polite). Mirrors the source
  // engine's ~8s auto-dismiss toast.
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 8000);
  }

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
          // The per-turn transcript (MEM-02) rides alongside the counters so the server
          // can persist court_turns + summarize the dossier on the terminal turn. Built
          // from `next` so it includes the turn just applied.
          body: JSON.stringify({ ...reportPayload(next, demand.rubricVersion), turns: transcriptPayload(next) }),
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
        {/* Pre-round greeting takeover (03-02): shown ONCE, only on a fresh playable round,
            BEFORE the demand. It never touches demand/axisWeights/initial favor (favor still
            opens 0/100). On continue it dismisses and the existing round flow runs unchanged. */}
        {greeting && !greetingDismissed && round.status === 'playing' && round.turns.length === 0 ? (
          <GreetingMoment greeting={greeting} onContinue={() => setGreetingDismissed(true)} />
        ) : (
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

          {/* WON / LOST takeover (read-only — whether freshly played or replay-blocked).
              The Share CTA (onShare) is GATED to the fresh-play path (isFreshPlay):
              on a replay-blocked re-open onShare is undefined so the CTA is omitted —
              never a blank-quote card (T-02-16). winStreak feeds the standing slot. */}
          {round.status === 'won' && (
            <EndState
              outcome="won"
              line={endLine('won')}
              turnsUsed={round.turns.length}
              winStreak={winStreak}
              onShare={isFreshPlay ? () => void handleShare('won') : undefined}
              sharePending={sharePending}
            />
          )}
          {round.status === 'lost' && (
            <EndState
              outcome="lost"
              line={endLine('lost')}
              turnsUsed={round.turns.length}
              winStreak={winStreak}
              onShare={isFreshPlay ? () => void handleShare('lost') : undefined}
              sharePending={sharePending}
            />
          )}

          {/* Card-generation error (02-06) — the in-voice "portraitist faltered" retry,
              reusing the ErrorState pattern. Try Again re-attempts the SAME draw. Only
              shown on a fresh-play finished round (the only path that can draw). */}
          {finished && isFreshPlay && cardError && (
            <CardErrorState onRetry={() => void handleShare(round.status === 'won' ? 'won' : 'lost')} disabled={sharePending} />
          )}

          {/* Share success toast (desktop "Card saved!" path; aria-live polite). */}
          {toast && (
            <p role="status" aria-live="polite" style={toastStyle}>
              {toast}
            </p>
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
        )}
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

const toastStyle: React.CSSProperties = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '14px',
  color: 'var(--yap-navy)',
  margin: 0,
  textAlign: 'center',
};

// The card-generation error state (02-06; UI-SPEC Copywriting Contract "Error state
// (card generation fails)"). Distinct copy from the judge-failure ErrorState.tsx — the
// canvas/toBlob draw failed, so we surface "The Emperor's portraitist faltered." with a
// Try Again that re-attempts the SAME draw (no turn/favor change — the round is over).
// Reuses the ErrorState visual pattern: 20px/700 navy heading + 16px body + 48px
// outlined retry. Announced via role="alert".
function CardErrorState({ onRetry, disabled = false }: { onRetry: () => void; disabled?: boolean }) {
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'center' }}>
      <p
        style={{
          fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
          fontSize: '20px',
          fontWeight: 700,
          lineHeight: 1.2,
          color: 'var(--yap-navy)',
          margin: 0,
        }}
      >
        The Emperor's portraitist faltered.
      </p>
      <p
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '16px',
          lineHeight: 1.5,
          color: 'rgba(27, 42, 74, 0.75)',
          margin: 0,
        }}
      >
        The card could not be drawn. Try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        style={{
          alignSelf: 'center',
          minHeight: '48px',
          minWidth: '44px',
          padding: '12px 24px',
          borderRadius: '8px',
          border: '1.5px solid var(--yap-navy)',
          backgroundColor: 'transparent',
          color: 'var(--yap-navy)',
          fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
          fontSize: '16px',
          fontWeight: 700,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        Try Again
      </button>
    </div>
  );
}
