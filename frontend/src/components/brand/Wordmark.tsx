/**
 * "CellForge" wordmark — `Cell` in foreground, `Forge` in accent.
 * Space Grotesk 600 with tightened letter-spacing for the Forge baseline.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={className}
      style={{
        fontFamily: '"Space Grotesk", system-ui, sans-serif',
        fontWeight: 600,
        letterSpacing: '-0.015em',
      }}
    >
      <span style={{ color: 'var(--color-text)' }}>Cell</span>
      <span style={{ color: 'var(--color-accent)' }}>Forge</span>
    </span>
  );
}
