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
  const hasAnimatedIn = useRef(false); // já animou de 0 na 1ª vez que entrou em view?
  const fromRef = useRef(0);           // valor de onde a animação atual parte
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // anima de `from` até `value`. Cancela qualquer animação em andamento.
    const animate = (from: number) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (reduce) { setDisplay(value); fromRef.current = value; return; }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        const cur = from + (value - from) * eased;
        setDisplay(cur);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
        else { setDisplay(value); fromRef.current = value; rafRef.current = null; }
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    // Já animou a entrada → o valor MUDOU (troca de filtro): re-anima do atual.
    if (hasAnimatedIn.current) {
      animate(fromRef.current);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }

    // 1ª vez: anima de 0 quando entra em view.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          hasAnimatedIn.current = true;
          animate(0);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => { io.disconnect(); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, durationMs]);

  return (
    <span ref={ref} className={className} style={style}>
      {formatNumber(display, format)}
    </span>
  );
}
