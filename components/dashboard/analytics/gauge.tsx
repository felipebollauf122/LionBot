"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "./animated-number";

interface GaugeProps {
  /** 0..1 */
  value: number;
  label?: string;
  size?: number;
}

/** Semicircle/arc gauge in synthwave neon — fills on view. Pure SVG + JS. */
export function Gauge({ value, label, size = 160 }: GaugeProps) {
  const v = Math.min(1, Math.max(0, value));
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const arc = 0.75; // 270° arc
  const dash = circumference * arc;

  const ref = useRef<SVGSVGElement>(null);
  const [filled, setFilled] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const id = requestAnimationFrame(() => setFilled(v));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          requestAnimationFrame(() => setFilled(v));
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [v]);

  const offset = dash * (1 - filled);

  return (
    <div className="flex flex-col items-center justify-center">
      <svg ref={ref} width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(135deg)" }}>
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={12} strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round" />
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
          style={{ filter: "drop-shadow(0 0 6px var(--accent-glow))", transition: "stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="-mt-[60%] text-center pointer-events-none">
        <p className="stat-value text-2xl text-foreground">
          <AnimatedNumber value={v * 100} format="pct2" />
        </p>
        {label && <p className="text-[11px] text-(--text-muted) mt-0.5">{label}</p>}
      </div>
    </div>
  );
}
