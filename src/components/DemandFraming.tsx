// The day's framed scene, in Yapoleon's voice, at the top of the round.
// UI-SPEC: Heading 20px Bricolage 700, navy ink. Read once, then recedes
// (tertiary in the visual hierarchy — the reaction + meter are the focal beat).

interface DemandFramingProps {
  sceneText: string;
}

export default function DemandFraming({ sceneText }: DemandFramingProps) {
  return (
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
      {sceneText}
    </p>
  );
}
