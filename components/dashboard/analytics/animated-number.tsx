"use client";

import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  /** format the (interpolated) numeric value into a display string */
  format?: (n: number) => string;
  durationMs?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Counts up from 0 → value with an ease-out curve when it scrolls into view.
 * Respects prefers-reduced-motion (jumps straight to the value).
 */
export function AnimatedNumber({ value, format, durationMs = 1100, className, style }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // async (rAF) so we don't call setState synchronously inside the effect body
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }

    const run = () => {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const from = 0;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        setDisplay(from + (value - from) * eased);
        if (t < 1) requestAnimationFrame(tick);
        else setDisplay(value);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, durationMs]);

  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString("pt-BR"));

  return (
    <span ref={ref} className={className} style={style}>
      {fmt(display)}
    </span>
  );
}
