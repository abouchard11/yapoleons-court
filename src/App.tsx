// Throwaway placeholder shell (Plan 01-01). The real RoundScreen — demand framing,
// favor meter, reply input, reaction line, end states — lands in Plan 01-02
// (UI-SPEC component inventory). This exists only so the forked scaffold builds
// green and renders a title; it deliberately has NO game logic.
export default function App() {
  return (
    <div className="game-container">
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          color: 'var(--yap-navy)',
        }}
      >
        <h1
          style={{
            fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
            fontSize: '2rem',
            fontWeight: 700,
            margin: 0,
          }}
        >
          Yapoleon&rsquo;s Court
        </h1>
        <p style={{ marginTop: '12px', maxWidth: '32ch', opacity: 0.75 }}>
          The Emperor is being prepared. His court opens soon.
        </p>
      </main>
    </div>
  );
}
