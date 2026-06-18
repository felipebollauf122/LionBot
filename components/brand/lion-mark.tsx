type LionMarkProps = {
  size?: number;
  className?: string;
  /** When true, renders with a soft neon drop-shadow glow. */
  glow?: boolean;
  /** When true, uses the version WITHOUT the dark rounded background (just the lion). */
  bare?: boolean;
};

/**
 * LionBot symbol — the detailed low-poly cyber lion (blue/purple mane, gold
 * aviator shades). Rendered as a single cached <img> of the brand SVG asset so
 * the 800+ facets don't re-render per instance (it appears ~14 places). Same
 * API as before (size / className / glow).
 */
export function LionMark({ size = 28, className, glow = true, bare = false }: LionMarkProps) {
  return (
    <img
      src={bare ? "/lion-bare.svg" : "/lion.svg"}
      width={size}
      height={size}
      alt="LionBot"
      className={className}
      style={glow ? { filter: "drop-shadow(0 0 8px rgba(255,43,214,0.45))" } : undefined}
      draggable={false}
    />
  );
}

export default LionMark;
