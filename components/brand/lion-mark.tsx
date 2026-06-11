import { useId } from "react";

type LionMarkProps = {
  size?: number;
  className?: string;
  /** When true, renders with a soft neon drop-shadow glow. */
  glow?: boolean;
};

/**
 * LionBot symbol — a majestic synthwave lion head with neon sunglasses.
 *
 * Two-layer neon mane (long outer blades + short inner blades = ~18 points,
 * giving real volume), an expressive geometric face, a snout with nose +
 * mouth, whiskers, ears — and neon shades as the focal point.
 *
 * THEME-AWARE: the gradients pull from CSS theme tokens (--accent, --purple,
 * --cyan) so the lion recolors with the active theme. Falls back to the
 * synthwave hexes when the tokens aren't set (e.g. raster/SSR). A touch more
 * vibrant than the rest of the UI so the mark pops.
 */
export function LionMark({ size = 28, className, glow = true }: LionMarkProps) {
  const id = useId();
  const stroke = `lm-stroke-${id}`;
  const fill = `lm-fill-${id}`;
  const maneFill = `lm-mane-${id}`;
  const eyeGlow = `lm-eye-${id}`;
  const lens = `lm-lens-${id}`;

  // Theme tokens with synthwave fallbacks — keeps the raster favicon correct.
  const cA = "var(--accent, #ff2bd6)";
  const cP = "var(--purple, #b14bff)";
  const cC = "var(--cyan, #00e5ff)";

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
          <stop offset="0%" stopColor={cA} />
          <stop offset="50%" stopColor={cP} />
          <stop offset="100%" stopColor={cC} />
        </linearGradient>
        <linearGradient id={fill} x1="14" y1="13" x2="34" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={cA} stopOpacity="0.26" />
          <stop offset="100%" stopColor={cC} stopOpacity="0.16" />
        </linearGradient>
        <radialGradient id={maneFill} cx="50%" cy="46%" r="55%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor={cP} stopOpacity="0.20" />
          <stop offset="100%" stopColor={cP} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={eyeGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor={cC} />
          <stop offset="100%" stopColor={cC} stopOpacity="0" />
        </radialGradient>
        {/* Glossy lens: dark core with a neon sheen pulled from the theme */}
        <linearGradient id={lens} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cC} stopOpacity="0.55" />
          <stop offset="42%" stopColor="#05030a" stopOpacity="0.95" />
          <stop offset="100%" stopColor={cA} stopOpacity="0.40" />
        </linearGradient>
      </defs>

      {/* Soft radial wash behind the mane for depth */}
      <circle cx="24" cy="24" r="21" fill={`url(#${maneFill})`} />

      {/* ── Mane: outer layer — 9 long neon blades ── */}
      <g stroke={`url(#${stroke})`} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill={cP} fillOpacity="0.07">
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
      <path d="M14 13 C12 10 12.5 7.5 15 8 C16.6 8.4 17.4 10 17.5 12 Z" fill={cA} fillOpacity="0.18" stroke={`url(#${stroke})`} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M34 13 C36 10 35.5 7.5 33 8 C31.4 8.4 30.6 10 30.5 12 Z" fill={cC} fillOpacity="0.16" stroke={`url(#${stroke})`} strokeWidth="1.8" strokeLinejoin="round" />

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

      {/* ── Neon sunglasses (focal point) ── */}
      {/* faint glow leaking from behind the lenses */}
      <ellipse cx="19.4" cy="22.8" rx="4.4" ry="3" fill={`url(#${eyeGlow})`} opacity="0.45" />
      <ellipse cx="28.6" cy="22.8" rx="4.4" ry="3" fill={`url(#${eyeGlow})`} opacity="0.45" />

      {/* bridge + temple arms (behind the lenses) */}
      <path d="M22.4 21.4 L25.6 21.4" stroke={`url(#${stroke})`} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14.6 21 L12.2 19.4" stroke={`url(#${stroke})`} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M33.4 21 L35.8 19.4" stroke={`url(#${stroke})`} strokeWidth="1.6" strokeLinecap="round" />

      {/* left lens — angular, glossy, dark with neon rim */}
      <path
        d="M14.8 20.6 L22.2 20.9 C22.3 23.6 20.9 25.4 18.4 25.4 C16 25.4 14.6 23.8 14.4 21.7 C14.35 21.05 14.5 20.6 14.8 20.6 Z"
        fill={`url(#${lens})`}
        stroke={`url(#${stroke})`}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* right lens (mirror) */}
      <path
        d="M33.2 20.6 L25.8 20.9 C25.7 23.6 27.1 25.4 29.6 25.4 C32 25.4 33.4 23.8 33.6 21.7 C33.65 21.05 33.5 20.6 33.2 20.6 Z"
        fill={`url(#${lens})`}
        stroke={`url(#${stroke})`}
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      {/* bright top-rim highlight on each lens */}
      <path d="M15.4 21.2 L21.6 21.4" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.85" />
      <path d="M32.6 21.2 L26.4 21.4" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.85" />
      {/* diagonal gleam streak across the left lens */}
      <path d="M16.4 24.2 L19.2 21.8" stroke={cC} strokeWidth="1" strokeLinecap="round" opacity="0.7" />

      {/* ── Muzzle: two cheek lobes ── */}
      <path
        d="M24 31 C21.5 35 17.5 34.5 18 31 C18.3 28.8 21 28.4 24 30 C27 28.4 29.7 28.8 30 31 C30.5 34.5 26.5 35 24 31 Z"
        fill={cP}
        fillOpacity="0.13"
        stroke={`url(#${stroke})`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Nose — solid downward triangle (classic lion muzzle) */}
      <path d="M21.4 26.6 L26.6 26.6 L24 30 Z" fill={cA} stroke={cA} strokeWidth="1.2" strokeLinejoin="round" />
      {/* Bridge from brow line down to nose */}
      <path d="M24 20 L24 26.6" stroke={`url(#${stroke})`} strokeWidth="1.5" strokeLinecap="round" />
      {/* Mouth — two curves under the nose */}
      <path d="M24 30 L24 32.4 M24 32.4 C22.7 33.8 21.4 33.6 20.6 32.6 M24 32.4 C25.3 33.8 26.6 33.6 27.4 32.6"
        stroke={`url(#${stroke})`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* ── Whiskers ── */}
      <g stroke={cC} strokeWidth="1.1" strokeLinecap="round" opacity="0.85">
        <path d="M18.5 30.4 L12.5 29" />
        <path d="M18.6 31.8 L13 33" />
        <path d="M29.5 30.4 L35.5 29" />
        <path d="M29.4 31.8 L35 33" />
      </g>
    </svg>
  );
}

export default LionMark;
