// In-flight state shown while the single judge call is pending. Copy: "Yapoleon
// considers…" (in-voice; the UI-SPEC bans generic spinner phrasing). Body 16px.
// The verdict should feel deliberated, so this beat lands before the reaction.

interface PendingIndicatorProps {
  visible: boolean;
}

export default function PendingIndicator({ visible }: PendingIndicatorProps) {
  if (!visible) return null;
  return (
    <p
      aria-live="polite"
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '16px',
        fontStyle: 'italic',
        color: 'rgba(27, 42, 74, 0.7)',
        margin: 0,
      }}
    >
      Yapoleon considers…
    </p>
  );
}
