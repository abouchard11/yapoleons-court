// First-run "how to play" card (and the explainer the persistent "?" reopens). The
// game otherwise drops a newcomer straight into an in-character demand + meter + text
// box with no premise — this card teaches what Yapoleon's Court IS and how a turn works,
// in three plain (lightly in-voice) lines, before the first greeting/demand. Shown once
// (a localStorage flag), reopenable any time from the round screen's "?" affordance.
//
// Same cream/navy idiom + reveal/reduced-motion/≥48px-CTA pattern as EndState/GreetingMoment.

import { useEffect, useState } from 'react';

interface OnboardingCardProps {
  onDismiss: () => void;
  /** "first-run" (Begin copy) vs "reopened" from the "?" (Got it copy). */
  mode?: 'first-run' | 'reopened';
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// The three things a newcomer needs: the premise, the action, the win condition.
const STEPS = [
  'Each day, Yapoleon — a haughty AI emperor — makes one demand of his court.',
  'Write a single witty reply. His taste is the only judge: the sharper your line, the more he thaws.',
  'You get 3 tries to raise his favor to 100. Win it, and his verdict is yours to screenshot and share.',
];

export default function OnboardingCard({ onDismiss, mode = 'first-run' }: OnboardingCardProps) {
  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const reduce = prefersReducedMotion();
    setReduceMotion(reduce);
    if (reduce) { setShown(true); return; }
    const id = window.setTimeout(() => setShown(true), 20);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="How to play Yapoleon's Court"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '20px',
        width: '100%',
        maxWidth: '32rem',
        opacity: shown ? 1 : 0,
        transform: shown || reduceMotion ? 'none' : 'translateY(6px)',
        transition: reduceMotion ? 'none' : 'opacity 320ms ease-out, transform 320ms ease-out',
      }}
    >
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--yap-navy)',
        }}
      >
        Yapoleon's Court
      </span>

      <h2
        style={{
          fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
          fontSize: '28px',
          fontWeight: 700,
          lineHeight: 1.2,
          color: 'var(--yap-navy)',
          margin: 0,
        }}
      >
        How to win his favor
      </h2>

      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          textAlign: 'left',
          width: '100%',
        }}
      >
        {STEPS.map((step, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span
              aria-hidden="true"
              style={{
                flex: '0 0 auto',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                border: '1.5px solid var(--yap-navy)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
                fontSize: '15px',
                fontWeight: 700,
                color: 'var(--yap-navy)',
                lineHeight: 1,
              }}
            >
              {i + 1}
            </span>
            <span
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '16px',
                lineHeight: 1.5,
                color: 'var(--yap-navy)',
              }}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={onDismiss}
        style={{
          marginTop: '4px',
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
          cursor: 'pointer',
        }}
      >
        {mode === 'reopened' ? 'Back to the court' : 'Enter the court'}
      </button>
    </section>
  );
}
