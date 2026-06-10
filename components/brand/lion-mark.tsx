import { useId } from "react";

type LionMarkProps = {
  size?: number;
  className?: string;
  /** When true, renders with a soft neon drop-shadow glow. */
  glow?: boolean;
};

/**
 * LionBot symbol — a geometric, synthwave lion head.
 * Angular mane rendered as neon rays with a magenta→cyan stroke gradient.
 * Pure SVG so it scales crisply and carries the brand glow everywhere
 * (navbar, sidebar, auth, favicon source of truth).
 */
export function LionMark({ size = 28, className, glow = true }: LionMarkProps) {
  const id = useId();
  const stroke = `lm-stroke-${id}`;
  const fill = `lm-fill-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="LionBot"
      style={glow ? { filter: "drop-shadow(0 0 8px rgba(255,43,214,0.55))" } : undefined}
    >
      <defs>
        <linearGradient id={stroke} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff2bd6" />
          <stop offset="55%" stopColor="#b14bff" />
          <stop offset="100%" stopColor="#00e5ff" />
        </linearGradient>
        <linearGradient id={fill} x1="14" y1="14" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255,43,214,0.20)" />
          <stop offset="100%" stopColor="rgba(0,229,255,0.12)" />
        </linearGradient>
      </defs>

      {/* Mane — 8 angular neon rays around the head */}
      <g stroke={`url(#${stroke})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M24 3 27 9 24 11 21 9 Z" />
        <path d="M38 7 37 14 33 13 34 8 Z" />
        <path d="M45 19 40 22 38 18 42 15 Z" />
        <path d="M44 33 38 32 39 27 44 28 Z" />
        <path d="M10 7 11 14 15 13 14 8 Z" />
        <path d="M3 19 8 22 10 18 6 15 Z" />
        <path d="M4 33 10 32 9 27 4 28 Z" />
      </g>

      {/* Head — hexagonal geometric face */}
      <path
        d="M24 10 L34 15 L36 25 L30 36 L24 39 L18 36 L12 25 L14 15 Z"
        fill={`url(#${fill})`}
        stroke={`url(#${stroke})`}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* Eyes — two neon slits */}
      <path d="M19 22 L23 23" stroke="#00e5ff" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M25 23 L29 22" stroke="#ff2bd6" strokeWidth="2.4" strokeLinecap="round" />

      {/* Snout / nose triangle */}
      <path
        d="M24 27 L21 31 L24 33 L27 31 Z"
        stroke={`url(#${stroke})`}
        strokeWidth="2"
        strokeLinejoin="round"
        fill="rgba(177,75,255,0.18)"
      />
    </svg>
  );
}

export default LionMark;
