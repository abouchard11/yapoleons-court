// The 3-turn progress (UI-SPEC Component Inventory TurnIndicator). Shows the CURRENT
// turn as "Turn N of 3" plus pips that make used-vs-remaining legible at a glance —
// state via text + filled/empty pip, never color alone (a11y). Label 14px Inter.
//
// `turnsUsed` is how many turns have been spent; the player is ON turn
// (turnsUsed + 1) while the round is still playable. Pip i is "spent" when
// i < turnsUsed. The numeric label is the accessible source of truth; the pips are
// a redundant visual cue.

interface TurnIndicatorProps {
  turnsUsed: number;
  turnsTotal?: number;
}

export default function TurnIndicator({ turnsUsed, turnsTotal = 3 }: TurnIndicatorProps) {
  const spent = Math.max(0, Math.min(turnsTotal, turnsUsed));
  // The current turn number (capped at total once all turns are spent).
  const current = Math.min(turnsTotal, spent + 1);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          color: 'var(--yap-navy)',
        }}
      >
        Turn {current} of {turnsTotal}
      </span>
      <span
        aria-hidden="true"
        style={{ display: 'inline-flex', gap: '8px' }}
      >
        {Array.from({ length: turnsTotal }, (_, i) => {
          const used = i < spent;
          return (
            <span
              key={i}
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: used ? 'var(--yap-navy)' : 'transparent',
                border: '1.5px solid var(--yap-navy)',
                opacity: used ? 1 : 0.4,
              }}
            />
          );
        })}
      </span>
    </div>
  );
}
