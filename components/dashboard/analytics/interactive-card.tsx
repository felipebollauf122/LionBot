"use client";

import { useRef, type ReactNode, type CSSProperties } from "react";

interface InteractiveCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** disables the mouse-tracked sheen + lift (e.g. for placeholders) */
  flat?: boolean;
}

/**
 * Card wrapper that tracks the cursor and exposes --mx/--my for the
 * .card-interactive radial sheen, plus lift/glow on hover. Client-only.
 */
export function InteractiveCard({ children, className, style, flat }: InteractiveCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    if (flat) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={`card ${flat ? "" : "card-interactive rail-top shimmer"} ${className ?? ""}`}
      style={style}
    >
      {children}
    </div>
  );
}
