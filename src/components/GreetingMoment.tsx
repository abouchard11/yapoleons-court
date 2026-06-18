// The pre-round greeting beat (MEM-01 / 03-UI-SPEC Surface 1). Structurally analogous
// to EndState (eyebrow + Display 28px line + reveal), but a PRE-round beat and NAVY-keyed
// — a greeting is neither a win nor a loss, so it never touches the reserved gold (the
// favor channel). Shown once per round open, then dismissed into the demand.
//
// Hallucination guard (UI-SPEC Presentation Contract): the callback fragment renders
// ONLY when greeting.callback carries BOTH a non-empty fragment AND a turnId. Absent ⇒
// the line renders alone. There is NO client path that synthesizes a callback from any
// other field; variant:'coldstart' carries no callback by contract.

import { useEffect, useState } from 'react';
import type { GreetingPayload } from '../court-dossier';

interface GreetingMomentProps {
  greeting: GreetingPayload;
  onContinue: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function GreetingMoment({ greeting, onContinue }: GreetingMomentProps) {
  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const reduce = prefersReducedMotion();
    setReduceMotion(reduce);
    if (reduce) { setShown(true); return; }
    const id = window.setTimeout(() => setShown(true), 20);
    return () => window.clearTimeout(id);
  }, [greeting.line]);

  // The ONLY callback gate: BOTH fields required. No other field can produce a callback.
  const hasCallback = Boolean(greeting.callback?.fragment && greeting.callback?.turnId);

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
        paddingTop: '48px',
        paddingBottom: '32px',
        opacity: shown ? 1 : 0,
        transform: shown || reduceMotion ? 'none' : 'translateY(6px)',
        transition: reduceMotion ? 'none' : 'opacity 320ms ease-out, transform 320ms ease-out',
      }}
    >
      {/* Eyebrow: rank/streak texture (Label 14px uppercase) — NAVY, never gold. */}
      {greeting.eyebrow && (
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '14px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--yap-navy)',
          }}
        >
          {greeting.eyebrow}
        </span>
      )}

      {/* The in-voice greeting line — Display 28px, navy (the focal pre-round beat). */}
      <p
        style={{
          fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
          fontSize: '28px',
          fontWeight: 700,
          lineHeight: 1.2,
          color: 'var(--yap-navy)',
          margin: 0,
        }}
      >
        {greeting.line}
      </p>

      {/* The grounded callback — the player's OWN verbatim line, shown ONLY when the
          payload carries a real fragment + turnId. This is the "he remembers YOU" proof;
          it is never synthesized client-side. Quoted, muted navy sub-line. */}
      {hasCallback && (
        <p
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '15px',
            fontStyle: 'italic',
            lineHeight: 1.45,
            color: 'rgba(27, 42, 74, 0.7)',
            margin: 0,
            maxWidth: '28rem',
          }}
        >
          “{greeting.callback!.fragment}”
        </p>
      )}

      {/* Continue affordance — a real focusable button at the 48px touch-target floor.
          A native <button> advances on click AND on Enter/Space (keyboard a11y). */}
      <button
        type="button"
        onClick={onContinue}
        aria-label="Continue to the Emperor's demand"
        style={{
          marginTop: '16px',
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
          cursor: 'pointer',
        }}
      >
        Proceed to his demand
      </button>
    </section>
  );
}
