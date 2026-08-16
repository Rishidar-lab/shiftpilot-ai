/**
 * ShiftPilot brand mark.
 *
 * Concept: three task bars ascending into order — short, mid, long — and the
 * longest bar resolves into a forward path (arrowhead). "Messy workload
 * becoming ordered movement." Renders in one color by default so it works on
 * any surface; `colored` adds the brand violet on the resolved path.
 */
export function ShiftMark({ size = 20, colored = false }: { size?: number; colored?: boolean }) {
  return (
    <svg
      width={size}
      height={(size * 24) / 36}
      viewBox="0 0 36 24"
      fill="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2"
        y="2"
        width="14"
        height="5"
        rx="2.5"
        fill="currentColor"
        opacity={colored ? 0.45 : 0.55}
      />
      <rect
        x="2"
        y="9.5"
        width="22"
        height="5"
        rx="2.5"
        fill="currentColor"
        opacity={colored ? 0.72 : 0.78}
      />
      <rect
        x="2"
        y="17"
        width="28"
        height="5"
        rx="2.5"
        fill={colored ? "var(--accent)" : "currentColor"}
        opacity={colored ? 1 : 1}
      />
      <path d="M29 16.5 L34 19.5 L29 22.5 Z" fill={colored ? "var(--accent)" : "currentColor"} />
    </svg>
  )
}

export function ShiftWordmark({
  size = 20,
  colored = false,
}: {
  size?: number
  colored?: boolean
}) {
  return (
    <span className="wordmark" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <ShiftMark size={size} colored={colored} />
      <span style={{ fontWeight: 660, letterSpacing: "-0.02em", fontSize: size * 0.82 }}>
        ShiftPilot
      </span>
    </span>
  )
}
