// The failed-judge-call state (UI-SPEC Screen States `error` + Copywriting Contract
// "Error state"). A failed Gemini judge call degrades here — NOT to a broken meter
// (T-01-20). The retry re-issues the SAME turn: onRetry re-calls the judge without
// advancing turns or changing favor (no turn is consumed — Task 1 error path).
//
// Copy is in-voice (the UI-SPEC bans generic "Error"/"Something went wrong" filler);
// the only literal "Try Again" is the mandated retry action label from the contract.
// The retry button has a ≥44px hit area (iOS HIG). Announced via role="alert".

interface ErrorStateProps {
  onRetry: () => void;
  disabled?: boolean;   // true while a retry is itself in flight
}

export default function ErrorState({ onRetry, disabled = false }: ErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        textAlign: 'center',
      }}
    >
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
        The Emperor has turned away — for the moment.
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
        Even an Emperor's attention wanders. Try once more.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={disabled}
        style={{
          alignSelf: 'center',
          minHeight: '44px',
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
