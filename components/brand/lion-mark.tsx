import { useId } from "react";

type LionMarkProps = {
  size?: number;
  className?: string;
  /** When true, renders with a soft neon drop-shadow glow. */
  glow?: boolean;
};

/**
 * LionBot symbol — a majestic synthwave lion head.
 *
 * Two-layer neon mane (long outer blades + short inner blades = ~18 points,
 * giving real volume), an expressive geometric face with fel-line eyes that
 * glow, ears, a snout with nose + mouth, and whiskers. Magenta→purple→cyan
 * stroke gradient throughout. Pure SVG so it stays crisp at every size and
 * carries the brand glow everywhere (navbar, sidebar, auth, favicon source).
 */
export function LionMark({ size = 28, className, glow = true }: LionMarkProps) {
  const id = useId();
  const stroke = `lm-stroke-${id}`;
  const fill = `lm-fill-${id}`;
  const maneFill = `lm-mane-${id}`;
  const eyeGlow = `lm-eye-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="LionBot"
      style={glow ? { filter: "drop-shadow(0 0 9px rgba(255,43,214,0.55))" } : undefined}
    >
      <defs>
        <linearGradient id={stroke} x1="5" y1="3" x2="43" y2="45" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff2bd6" />
          <stop offset="50%" stopColor="#b14bff" />
          <stop offset="100%" stopColor="#00e5ff" />
        </linearGradient>
        <linearGradient id={fill} x1="14" y1="13" x2="34" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255,43,214,0.24)" />
          <stop offset="100%" stopColor="rgba(0,229,255,0.14)" />
        </linearGradient>
        <radialGradient id={maneFill} cx="50%" cy="46%" r="55%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="rgba(177,75,255,0.18)" />
          <stop offset="100%" stopColor="rgba(177,75,255,0)" />
        </radialGradient>
        <radialGradient id={eyeGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#aef9ff" />
          <stop offset="60%" stopColor="#00e5ff" />
          <stop offset="100%" stopColor="rgba(0,229,255,0)" />
        </radialGradient>
      </defs>

      {/* Soft radial wash behind the mane for depth */}
      <circle cx="24" cy="24" r="21" fill={`url(#${maneFill})`} />

      {/* ── Mane: outer layer — 9 long neon blades ── */}
      <g stroke={`url(#${stroke})`} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="rgba(177,75,255,0.06)">
        <path d="M24 1 26.4 8 24 10 21.6 8 Z" />
        <path d="M35 2.6 34.4 10 31 9.2 32 3.4 Z" />
        <path d="M13 2.6 13.6 10 17 9.2 16 3.4 Z" />
        <path d="M44.4 11 39.4 15.6 37 12.4 41.4 9 Z" />
        <path d="M3.6 11 8.6 15.6 11 12.4 6.6 9 Z" />
        <path d="M47 23.5 40 24 40 20 46 20.6 Z" />
        <path d="M1 23.5 8 24 8 20 2 20.6 Z" />
        <path d="M45 35 38.5 33.5 39.6 28.8 45 30.4 Z" />
        <path d="M3 35 9.5 33.5 8.4 28.8 3 30.4 Z" />
      </g>

      {/* ── Mane: inner layer — 8 short blades filling the gaps ── */}
      <g stroke={`url(#${stroke})`} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.92">
        <path d="M30 5 30.5 10 27.4 10.4 Z" />
        <path d="M18 5 17.5 10 20.6 10.4 Z" />
        <path d="M40 17 36.5 19.5 35.4 16.4 Z" />
        <path d="M8 17 11.5 19.5 12.6 16.4 Z" />
        <path d="M41 28 36.5 28.4 37.4 25 Z" />
        <path d="M7 28 11.5 28.4 10.6 25 Z" />
        <path d="M40 37 35.5 35.6 37.6 32.6 Z" />
        <path d="M8 37 12.5 35.6 10.4 32.6 Z" />
      </g>

      {/* ── Ears — rounded, sitting above the mane so they read clearly ── */}
      <path d="M14 13 C12 10 12.5 7.5 15 8 C16.6 8.4 17.4 10 17.5 12 Z" fill="rgba(255,43,214,0.16)" stroke={`url(#${stroke})`} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M34 13 C36 10 35.5 7.5 33 8 C31.4 8.4 30.6 10 30.5 12 Z" fill="rgba(0,229,255,0.14)" stroke={`url(#${stroke})`} strokeWidth="1.8" strokeLinejoin="round" />

      {/* ── Head: expressive geometric face ── */}
      <path
        d="M24 9
           L31 11.5 L34 16
           L35 24 L32 31 L27.5 36 L24 38
           L20.5 36 L16 31 L13 24 L14 16 L17 11.5 Z"
        fill={`url(#${fill})`}
        stroke={`url(#${stroke})`}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />

      {/* Brow ridges — angled inward for a fierce, focused look */}
      <path d="M16 19 L21.8 18.2 22.4 19.8" stroke={`url(#${stroke})`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M32 19 L26.2 18.2 25.6 19.8" stroke={`url(#${stroke})`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* ── Eyes: glowing feline slits with a bright core ── */}
      <ellipse cx="19.6" cy="22.6" rx="3.2" ry="2" fill={`url(#${eyeGlow})`} opacity="0.9" />
      <ellipse cx="28.4" cy="22.6" rx="3.2" ry="2" fill={`url(#${eyeGlow})`} opacity="0.9" />
      <path d="M17.4 23.1 L21.8 21.9" stroke="#eafdff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M26.2 21.9 L30.6 23.1" stroke="#eafdff" strokeWidth="2.2" strokeLinecap="round" />

      {/* ── Muzzle: two cheek lobes ── */}
      <path
        d="M24 31 C21.5 35 17.5 34.5 18 31 C18.3 28.8 21 28.4 24 30 C27 28.4 29.7 28.8 30 31 C30.5 34.5 26.5 35 24 31 Z"
        fill="rgba(177,75,255,0.12)"
        stroke={`url(#${stroke})`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Nose — solid downward triangle (classic lion muzzle) */}
      <path d="M21.4 26.6 L26.6 26.6 L24 30 Z" fill="#ff2bd6" stroke="#ff2bd6" strokeWidth="1.2" strokeLinejoin="round" />
      {/* Bridge from brow line down to nose */}
      <path d="M24 20 L24 26.6" stroke={`url(#${stroke})`} strokeWidth="1.5" strokeLinecap="round" />
      {/* Mouth — two curves under the nose */}
      <path d="M24 30 L24 32.4 M24 32.4 C22.7 33.8 21.4 33.6 20.6 32.6 M24 32.4 C25.3 33.8 26.6 33.6 27.4 32.6"
        stroke={`url(#${stroke})`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* ── Whiskers ── */}
      <g stroke="#00e5ff" strokeWidth="1.1" strokeLinecap="round" opacity="0.85">
        <path d="M18.5 30.4 L12.5 29" />
        <path d="M18.6 31.8 L13 33" />
        <path d="M29.5 30.4 L35.5 29" />
        <path d="M29.4 31.8 L35 33" />
      </g>
    </svg>
  );
}

export default LionMark;
