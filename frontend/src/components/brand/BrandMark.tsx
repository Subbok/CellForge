/**
 * The Forge brand mark: square brackets containing one accent-filled cell.
 * Stroke uses currentColor so the brackets pick up the surrounding text color;
 * the cell rect is locked to the active accent.
 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 4H2v16h3"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 4h3v16h-3"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={7}
        y={9}
        width={10}
        height={6}
        rx={1.5}
        style={{ fill: 'var(--color-accent)' }}
      />
    </svg>
  );
}
