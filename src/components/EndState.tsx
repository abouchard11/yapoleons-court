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

import { useEffect, useState } from 'react';

interface EndStateProps {
  outcome: 'won' | 'lost';
  line: string;        // the in-voice concession / dismissal line (the judge's final reaction)
  turnsUsed: number;   // colors the win sub-beat: "Favor won in N"
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function EndState({ outcome, line, turnsUsed }: EndStateProps) {
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

      {/* Win standing sub-line (Body 16px). Loss has no sub-line in P1 (the card is Phase 2). */}
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
    </section>
  );
}
