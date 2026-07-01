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
import OnboardingCard from './components/OnboardingCard';
import { fetchGreeting, type GreetingPayload } from './court-dossier';
import { ensureIdentity, apiFetch, identifyPlayer, getPlayerId } from './court-identity';
import { StorageAdapter } from './storage-adapter';
import { selectDailyDemand, type DemandRecord } from './demands';
import { getDayNumber } from './daily';
import { judgeReply, isModerationFlag, trackEvent } from './gemini-client';
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
//   'brushoff' (SAFE-02): a red-line submission was refused server-side BEFORE the
//   judge ran. Like 'error', the round is UNCHANGED — no turn consumed, favor does
//   not move, the reply stays intact — but the copy is Yapoleon's in-voice brush-off,
//   not the generic "attention wandered" error. UNLIKE 'error', there is no
//   resubmit-the-same-text retry: the ReplyInput stays mounted so the player must
//   EDIT the flagged reply and resubmit (D-06) — a red line would just flag again.
export type UiPhase = 'idle' | 'pending' | 'revealed' | 'error' | 'brushoff';

// Should the editable ReplyInput + SubmitButton be mounted for this state? Shown
// whenever the round is still playable and we are NOT in the judge-failure 'error'
// state (which owns its own same-reply retry). CRUCIALLY the 'brushoff' state DOES
// keep the input mounted (this predicate returns true): a SAFE-02 red-line is not
// consumed and the player must EDIT the flagged reply and resubmit, so there must be
// no way to get stuck resubmitting identical red-line text (D-06). Pure — exported for
// the RoundScreen brush-off regression test.
export function shouldShowReplyInput(uiPhase: UiPhase, finished: boolean): boolean {
  return !finished && uiPhase !== 'error';
}

// First-run flag (StorageAdapter / KNOWN_KEYS): once set, the "how to play" card no
// longer auto-shows; the persistent "?" reopens it on demand.
const ONBOARDING_KEY = 'court.onboarding.seen.v1';

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

  // First-run onboarding: the "how to play" card auto-shows once (no flag yet), then is
  // reopenable from the persistent "?" affordance. The lazy initializers read the flag
  // synchronously (StorageAdapter.init() already ran in main.tsx before mount).
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(() => !StorageAdapter.getItem(ONBOARDING_KEY));
  const [onboardingMode, setOnboardingMode] = useState<'first-run' | 'reopened'>(
    () => (StorageAdapter.getItem(ONBOARDING_KEY) ? 'reopened' : 'first-run'),
  );

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
        // VAL-01 (first-launch site): the id was just minted async (absent when main.tsx's
        // module-load posthog.init ran), so this is where a brand-new player is identified —
        // the exact cohort D1 retention needs. Idempotent + truthy-id-guarded; no person-props.
        identifyPlayer();
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
        // VAL-04: round_started fires ONCE per fresh playable round (this branch is the
        // fresh-round gate — NOT a replay-blocked re-open, which resolves to a terminal
        // server round, NOR a resumed mid-round, which has turns.length > 0). It is the
        // funnel entry point that catches a pre-turn-1 bounce (round_started with no
        // turn_submitted). Anonymous player_id only — no PII.
        trackEvent('round_started', { player_id: getPlayerId(), day, tier: 'fairfight' });
        const g = await fetchGreeting();
        if (!cancelled && g) setGreeting(g);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const dismissOnboarding = () => {
    StorageAdapter.setItem(ONBOARDING_KEY, '1');
    setOnboardingOpen(false);
  };
  const openOnboarding = () => { setOnboardingMode('reopened'); setOnboardingOpen(true); };

  // First-run onboarding takes over before anything else — even before the round
  // resolves — so a newcomer sees how to play, not a loading veil or an opaque demand.
  if (onboardingOpen) {
    return (
      <div className="game-container">
        <main style={mainStyle}>
          <OnboardingCard onDismiss={dismissOnboarding} mode={onboardingMode} />
        </main>
      </div>
    );
  }

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

      // VAL-04: turn_submitted fires at the point of submission, BEFORE the judge await —
      // so it counts the ATTEMPT even if the judge then throws (a SAFE-02 moderation flag,
      // a network/parse failure). turn_index is the pre-turn count (round.turns is the
      // pre-turn state — this reply is not in it yet); reply_length is a NUMBER only —
      // the reply free-text is NEVER sent (D-07 / no PII). Powers per-turn abandonment +
      // the effort proxy + within-round engagement decay.
      trackEvent('turn_submitted', { player_id: getPlayerId(), turn_index: round.turns.length, reply_length: text.length });

      // ONE structured judge call → server-derived favorDelta. Pass the player's OWN
      // earlier replies THIS round (round.turns is the pre-turn state — the current reply
      // is not in it yet) so the judge's deterministic near-dup pre-check (JUDGE-05) has
      // real prior text to compare against. The JUDGE-07 shape signal needs no client
      // change — the judge reads shape_notes server-side from the dossier.
      const result = await judgeReply(demand, text, round.turns.map((t) => t.reply));

      // Advance the round state machine (clamp + win/lose transitions).
      const next = applyTurn(round, text, result);

      // VAL-04: round_completed fires ONLY on a TERMINAL applyTurn (won/lost) — the round's
      // terminal verdict. It is UNREACHABLE on a SAFE-02 moderation-flagged turn: judgeReply
      // throws during the await above, so applyTurn never runs and control jumps to catch
      // (the brush-off branch) — a flagged attempt is a turn_submitted, never a
      // round_completed. Anonymous player_id + non-PII outcome/turns/favor only.
      if (next.status !== 'playing') {
        trackEvent('round_completed', { player_id: getPlayerId(), outcome: next.status, turns_used: next.turns.length, final_favor: next.favor });
      }

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
    } catch (err) {
      // SAFE-02: a red-line submission is refused server-side BEFORE the judge runs
      // (moderation_flagged). It is NOT a judge failure — render the in-voice brush-off
      // instead of the generic error. CRITICALLY, like the error path, the round is
      // UNCHANGED: no applyTurn ran, so the turn is NOT consumed, favor does not move,
      // and the reply is left intact (NOT cleared) so the player can edit + retry.
      // (D-06 forgiving — a false positive costs the player nothing.)
      if (isModerationFlag(err)) {
        setUiPhase('brushoff');
        return;
      }
      // Judge call failed → error state. The round is UNCHANGED (no applyTurn ran),
      // so the turn was not consumed and the favor did not move. "Try Again"
      // re-issues this same turn with the reply still intact.
      setUiPhase('error');
    }
  }

  const handleSubmit = () => { if (canSubmit) void submitTurn(reply.trim()); };
  // Retry re-issues the SAME turn: the reply is still in state (it is only cleared on
  // a SUCCESSFUL turn), so we re-judge the current reply without advancing anything.
  // This is ONLY for the judge-FAILURE error path (a failed judge call legitimately
  // retries the same reply). The SAFE-02 brush-off path deliberately does NOT use this
  // — resubmitting identical red-line text would just flag again (infinite loop); the
  // player edits the reply and submits through the normal handleSubmit path instead.
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

          {/* BRUSH-OFF (SAFE-02): a red-line submission was refused before the judge.
              In-voice, turn NOT consumed. It is a passive BANNER with NO retry button —
              the editable ReplyInput + SubmitButton stay mounted below so the player
              EDITS the flagged reply and resubmits normally (D-06). This is what
              prevents the infinite loop of re-issuing the same red-line text. */}
          {uiPhase === 'brushoff' && !finished && (
            <BrushOffBanner />
          )}

          {/* Input + CTA + turn counter — shown while the round is still playable and
              not in the judge-failure error state (which owns its own retry of the same
              reply). The brush-off state DOES keep the input mounted: the player must
              edit the flagged reply before resubmitting, so there is no way to get stuck
              resubmitting identical red-line text. See shouldShowReplyInput. */}
          {shouldShowReplyInput(uiPhase, finished) && (
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
      {/* Persistent "?" — reopens the how-to-play card any time (the operator-chosen
          first-run-card + persistent-help affordance). Quiet, top-right, out of the flow. */}
      <HelpButton onClick={openOnboarding} />
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

// The persistent "?" help affordance — a quiet, fixed top-right circle that reopens the
// how-to-play card. Out of the content flow (fixed), respects the safe-area inset, ≥44px
// hit area. Navy outline on the cream canvas; never competes with the favor meter.
function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="How to play"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: '1.5px solid rgba(27, 42, 74, 0.45)',
        backgroundColor: 'var(--yap-cream)',
        color: 'var(--yap-navy)',
        fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
        fontSize: '18px',
        fontWeight: 700,
        lineHeight: 1,
        cursor: 'pointer',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      ?
    </button>
  );
}

// The SAFE-02 brush-off BANNER — shown when the server refuses a red-line submission
// (slur/hate, credible threat, sexual content involving a minor) BEFORE the judge runs.
// Distinct copy from the judge-failure ErrorState (the Emperor is REFUSING, not
// distracted) and from the card-error state.
//
// CONTRACT (D-06): a flagged turn is NOT consumed and the player must EDIT the reply
// and retry. So this is a passive in-voice BANNER, NOT an action card — it deliberately
// owns NO "Try Again" button. The editable ReplyInput + SubmitButton stay mounted below
// (with the preserved reply), so the player edits the offending text and resubmits
// through the normal submit path. This closes the infinite brush-off loop where a
// button re-issued the SAME red-line text (which would flag again forever).
//
// Copy discipline: the brush-off itself MUST pass the SAFE-01 all-ages bound — the barb
// lands on the GUTTER-TALK (the attempt), never the person or a protected trait, and
// carries no slur/strong profanity. Announced via role="alert".
// Exported for the RoundScreen brush-off regression test (it asserts the banner owns
// no button — the fix that broke the infinite same-text resubmit loop).
export function BrushOffBanner() {
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
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
        The Emperor will not stoop to answer that.
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
        Gutter-talk earns no audience. Edit your reply — bring wit, not filth — and send it again.
      </p>
    </div>
  );
}

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
