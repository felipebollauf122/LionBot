interface GaugeProps {
  /** 0..1 */
  value: number;
  label?: string;
  size?: number;
}

/** Semicircle/arc gauge in synthwave neon — pure SVG. */
export function Gauge({ value, label, size = 160 }: GaugeProps) {
  const v = Math.min(1, Math.max(0, value));
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  // use 270° arc (gap at bottom)
  const arc = 0.75;
  const dash = circumference * arc;
  const offset = dash * (1 - v);

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(135deg)" }}>
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={12}
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="url(#gauge-grad)"
          strokeWidth={12}
          strokeDasharray={`${dash} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px var(--accent-glow))", transition: "stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="-mt-[60%] text-center pointer-events-none">
        <p className="stat-value text-2xl text-foreground">{(v * 100).toFixed(2)}%</p>
        {label && <p className="text-[11px] text-(--text-muted) mt-0.5">{label}</p>}
      </div>
    </div>
  );
}
