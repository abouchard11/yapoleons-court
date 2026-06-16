// The end-state takeover sheet — the round's closing beat (UI-SPEC Screen States
// won/lost + Component Inventory EndState). A FRESH hand-rolled build whose LAYOUT
// (a centered takeover with breathing room above the line) mirrors the source
// engine's ResultSheet structure only — none of its Wordle content.
//
//   won  → GOLD-keyed concession: the in-voice concession line (Display 28px) +
//          "Favor won in {N}" sub-line (Body 16px). Gold is reserved (UI-SPEC) for
//          the win keying + the meter; the win line gets the gold accent rule.
//   lost → CRIMSON-keyed dismissal: the in-voice dismissal line (Display 28px),
//          entertaining + spoiler-safe. Crimson is the loss/alarm color.
//
// The `line` is the judge's final-turn reaction in Yapoleon's concession/dismissal
// voice (one call, must-nail #3 — no separate end-state model call). State is NEVER
// conveyed by color alone: the win carries the explicit "Favor won in N" text and a
// 🏆 partner; the loss carries an explicit "Dismissed." label partner. Announced via
// aria-live (UI-SPEC a11y). prefers-reduced-motion → instant (no fade).
//
// Phase 2 (02-06): the Share CTA + win-streak standing slot hang BELOW the line.
//   • onShare      — the round-screen handler that assembles the live card payload
//                    and fires the web-first share cascade (src/share.ts). When it is
//                    absent (a replay-blocked re-open with no live lines), the CTA is
//                    OMITTED rather than rendering a blank-quote card (Pitfall 1 / T-02-16).
//   • winStreak    — consecutive days won (D-03, from court-can-play). Rendered in-voice
//                    text ("N-day streak") only when > 0.
//   • sharePending — drawing/awaiting the share sheet; disables the CTA + shows a beat.
// The CTA reuses SubmitButton's affordance (navy fill, 16px/700 Bricolage) at the
// UI-SPEC 48px touch-target floor, with a descriptive aria-label.

import { useEffect, useState } from 'react';

interface EndStateProps {
  outcome: 'won' | 'lost';
  line: string;        // the in-voice concession / dismissal line (the judge's final reaction)
  turnsUsed: number;   // colors the win sub-beat: "Favor won in N"
  onShare?: () => void;     // 02-06: fire the share cascade; absent ⇒ no CTA (replay-degrade)
  winStreak?: number;       // 02-06: consecutive days won (D-03); the standing slot, shown when > 0
  sharePending?: boolean;   // 02-06: the card is drawing / the OS sheet is opening
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function EndState({
  outcome,
  line,
  turnsUsed,
  onShare,
  winStreak,
  sharePending = false,
}: EndStateProps) {
  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const reduce = prefersReducedMotion();
    setReduceMotion(reduce);
    if (reduce) { setShown(true); return; }
    const id = window.setTimeout(() => setShown(true), 20);
    return () => window.clearTimeout(id);
  }, [outcome, line]);

  const won = outcome === 'won';
  const accent = won ? 'var(--yap-gold)' : 'var(--yap-crimson)';

  // The win-streak standing slot (D-03). In-voice text, never color-only. Shown on a
  // win when a positive run exists; on a loss only when the player still holds a run
  // (D-04 lets the loser save face — a streak survives a single dismissal until the
  // next play, per the can-play "anchor at most-recent WON day" reset rule).
  const hasStreak = typeof winStreak === 'number' && winStreak > 0;

  // CTA copy (UI-SPEC Copywriting Contract): verb + noun, in-voice. The loss is
  // content too ("entertaining failure"), so it shares the Dismissal.
  const ctaLabel = won ? 'Share the Concession' : 'Share the Dismissal';
  const ctaAria = won
    ? "Share Yapoleon's concession as a card"
    : "Share Yapoleon's dismissal as a card";

  return (
    <section
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '8px',
        // 3xl breathing room above the line (UI-SPEC spacing exception for the takeover).
        paddingTop: '64px',
        paddingBottom: '48px',
        opacity: shown ? 1 : 0,
        transform: shown || reduceMotion ? 'none' : 'translateY(6px)',
        transition: reduceMotion ? 'none' : 'opacity 320ms ease-out, transform 320ms ease-out',
      }}
    >
      {/* Explicit text/icon partner so the win/loss is never color-only (a11y). */}
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: accent,
        }}
      >
        {won ? '🏆 His favor, won' : 'Dismissed'}
      </span>

      {/* The in-voice line — Display 28px, the quotable closing beat. */}
      <p
        style={{
          fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
          fontSize: '28px',
          fontWeight: 700,
          lineHeight: 1.2,
          color: won ? 'var(--yap-navy)' : 'var(--yap-crimson)',
          margin: 0,
        }}
      >
        {line}
      </p>

      {/* Win standing sub-line (Body 16px). Loss has no "Favor won in N" sub-line. */}
      {won && (
        <p
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            color: 'var(--yap-navy)',
            margin: 0,
          }}
        >
          Favor won in {turnsUsed}.
        </p>
      )}

      {/* Win-streak standing slot (D-03) — in-voice text, carried by TEXT not color
          (a11y). Shown when a positive run exists (on a win always; on a loss only if
          the run still stands — let the loser save face, D-04). */}
      {hasStreak && (
        <p
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '14px',
            color: 'var(--yap-navy)',
            margin: 0,
          }}
        >
          🔥 {winStreak}-day streak
        </p>
      )}

      {/* Share CTA (02-06) — reuses SubmitButton's affordance at the UI-SPEC 48px
          touch-target floor. OMITTED on a replay-blocked re-open (onShare absent) so a
          blank-quote card is never produced (Pitfall 1 / T-02-16). */}
      {onShare && (
        <button
          type="button"
          onClick={onShare}
          disabled={sharePending}
          aria-label={ctaAria}
          style={{
            marginTop: '16px',
            width: '100%',
            minHeight: '48px',
            padding: '12px 16px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'var(--yap-navy)',
            color: 'var(--yap-cream)',
            fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
            fontSize: '16px',
            fontWeight: 700,
            cursor: sharePending ? 'not-allowed' : 'pointer',
            opacity: sharePending ? 0.45 : 1,
          }}
        >
          {sharePending ? 'Composing the portrait…' : ctaLabel}
        </button>
      )}
    </section>
  );
}
