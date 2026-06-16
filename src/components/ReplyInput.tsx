// Free-text reply area with a ~500-char hard cap, a live "{n} / 500" counter
// (Label 14px, crimson within the last ~25 chars to cue the economy axis), and an
// in-voice placeholder. Body 16px Inter for the input text. Disabled during pending.

interface ReplyInputProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

const DEFAULT_MAX = 500; // D-05 working cap

export default function ReplyInput({
  value,
  onChange,
  maxLength = DEFAULT_MAX,
  disabled = false,
}: ReplyInputProps) {
  const remaining = maxLength - value.length;
  const nearLimit = remaining <= 25;
  const counterId = 'reply-counter';

  return (
    <div>
      <textarea
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        placeholder="The Emperor is waiting. Make it worth his time."
        rows={4}
        aria-label="Your reply to the Emperor"
        aria-describedby={counterId}
        style={{
          width: '100%',
          resize: 'vertical',
          minHeight: '96px',
          padding: '12px',
          borderRadius: '8px',
          border: '1.5px solid rgba(27, 42, 74, 0.25)',
          backgroundColor: 'rgba(255, 255, 255, 0.5)',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '16px',
          lineHeight: 1.5,
          color: 'var(--yap-navy)',
          opacity: disabled ? 0.55 : 1,
        }}
      />
      <div
        id={counterId}
        aria-live={nearLimit ? 'polite' : 'off'}
        style={{
          textAlign: 'right',
          marginTop: '4px',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          color: nearLimit ? 'var(--yap-crimson)' : 'rgba(27, 42, 74, 0.6)',
        }}
      >
        {value.length} / {maxLength}
      </div>
    </div>
  );
}
