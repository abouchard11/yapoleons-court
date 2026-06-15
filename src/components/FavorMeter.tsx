// Single horizontal 0–100 favor bar: gold fill on a navy track. Animates the
// fill width on each turn (~300–500ms ease-out), floors at 0, full at 100.
//
// METER a11y (UI-SPEC Color / Accessibility): state is NEVER conveyed by the gold
// fill alone — the meter always exposes role="progressbar" + aria-valuenow + a
// VISIBLE "FAVOR" label + the numeric value (Label 14px). A negative delta is cued
// by the number going down + a crimson delta marker, never by color alone.
// prefers-reduced-motion → instant (no width transition).

import { useEffect, useState } from 'react';

interface FavorMeterProps {
  favor: number;        // 0..100 (already clamped by the round machine)
  lastDelta?: number;   // the most recent turn's favorDelta (for the cue)
  animating?: boolean;  // whether the meter should animate to its new value
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function FavorMeter({ favor, lastDelta }: FavorMeterProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(favor)));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(prefersReducedMotion());
  }, []);

  const deltaIsNegative = typeof lastDelta === 'number' && lastDelta < 0;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '14px',
            letterSpacing: '0.08em',
            color: 'var(--yap-navy)',
          }}
        >
          FAVOR
        </span>
        <span
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '14px',
            color: 'var(--yap-navy)',
          }}
        >
          {typeof lastDelta === 'number' && lastDelta !== 0 && (
            <span
              style={{
                marginRight: '8px',
                color: deltaIsNegative ? 'var(--yap-crimson)' : 'var(--yap-navy)',
              }}
            >
              {lastDelta > 0 ? `+${lastDelta}` : `${lastDelta}`}
            </span>
          )}
          <strong>{clamped}</strong>
          <span style={{ opacity: 0.5 }}> / 100</span>
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Favor"
        style={{
          position: 'relative',
          height: '12px',
          borderRadius: '6px',
          backgroundColor: 'var(--yap-navy)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${clamped}%`,
            backgroundColor: 'var(--yap-gold)',
            borderRadius: '6px',
            transition: reduceMotion ? 'none' : 'width 400ms ease-out',
          }}
        />
      </div>
    </div>
  );
}
