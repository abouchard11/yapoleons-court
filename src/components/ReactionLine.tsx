// Yapoleon's in-voice reaction — the screenshot beat. Highest-contrast type on
// the screen: Display 28px Bricolage 700, navy. Reveals (opacity fade-in) after
// the pending beat. This is the primary focal anchor of the round (UI-SPEC
// Visual Hierarchy), the quotable moment even before the Phase-2 share card.
// prefers-reduced-motion → no fade (instant).

import { useEffect, useState } from 'react';

interface ReactionLineProps {
  reaction: string;
  delta?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function ReactionLine({ reaction }: ReactionLineProps) {
  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const reduce = prefersReducedMotion();
    setReduceMotion(reduce);
    if (reduce) {
      setShown(true);
      return;
    }
    // Brief opacity fade-in so the reveal lands after the "considers…" beat.
    const id = window.setTimeout(() => setShown(true), 20);
    return () => window.clearTimeout(id);
  }, [reaction]);

  if (!reaction) return null;

  return (
    <p
      aria-live="polite"
      style={{
        fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
        fontSize: '28px',
        fontWeight: 700,
        lineHeight: 1.2,
        color: 'var(--yap-navy)',
        margin: 0,
        opacity: shown ? 1 : 0,
        transition: reduceMotion ? 'none' : 'opacity 300ms ease-out',
      }}
    >
      {reaction}
    </p>
  );
}
