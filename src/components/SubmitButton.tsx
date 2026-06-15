// Primary CTA — "Address the Emperor" (the UI-SPEC bans generic-assistant verbs
// here). Navy fill, ≥44px hit area (iOS HIG). Disabled while the input is empty
// or a turn is pending. Copy is in-voice per the UI-SPEC copywriting contract.

interface AddressButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export default function SubmitButton({ onClick, disabled = false }: AddressButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        minHeight: '44px',
        padding: '12px 16px',
        borderRadius: '8px',
        border: 'none',
        backgroundColor: 'var(--yap-navy)',
        color: 'var(--yap-cream)',
        fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
        fontSize: '16px',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      Address the Emperor
    </button>
  );
}
