"use client";

import { useEffect, useRef, useState } from "react";

/** Serializable format kinds — safe to pass across the server→client boundary. */
export type NumberFormat = "int" | "brl" | "pct" | "pct1" | "pct2" | "mult";

export function formatNumber(n: number, fmt: NumberFormat = "int"): string {
  switch (fmt) {
    case "brl":
      return (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    case "pct":
      return `${Math.round(n)}%`;
    case "pct1":
      return `${n.toFixed(1)}%`;
    case "pct2":
      return `${n.toFixed(2)}%`;
    case "mult":
      return `${n.toFixed(1)}×`;
    case "int":
    default:
      return Math.round(n).toLocaleString("pt-BR");
  }
}

interface AnimatedNumberProps {
  value: number;
  /** serializable format kind (NOT a function — must cross the RSC boundary) */
  format?: NumberFormat;
  durationMs?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Counts up from 0 → value with an ease-out curve when it scrolls into view.
 * Respects prefers-reduced-motion (jumps straight to the value).
 */
export function AnimatedNumber({ value, format = "int", durationMs = 1100, className, style }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }

    const run = () => {
      if (started.current) return;
      started.current = true;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        setDisplay(value * eased);
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

  return (
    <span ref={ref} className={className} style={style}>
      {formatNumber(display, format)}
    </span>
  );
}
