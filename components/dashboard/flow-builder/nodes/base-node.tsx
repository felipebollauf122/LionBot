"use client";

import type { CSSProperties, ReactNode } from "react";
import { NODE_META, handleStyle, isNodeIncomplete, formatAutoDelete } from "../flow-utils";

/** var(--cyan) → var(--cyan-glow, var(--cyan)); qualquer outro valor passa direto. */
function glowOf(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
  return m ? `var(${m[1]}-glow, ${color})` : color;
}

/**
 * Handle renderizado no fluxo do card (dentro de flex), não absoluto na borda:
 * mantém a hitbox de 24px do handleStyle e neutraliza o posicionamento
 * absoluto padrão do xyflow.
 */
export function inlineHandleStyle(color: string): CSSProperties {
  // A classe .react-flow__handle-bottom da lib define left:50%/bottom:0/
  // top:auto (parte do truque de centralização por position:absolute +
  // transform:-50%). Sob position:relative esse left:50% passa a significar
  // "desloque 50% da largura do container" — precisa ser neutralizado junto
  // com o transform, senão o ponto do handle sai deslocado do rótulo.
  return {
    ...handleStyle(color),
    position: "relative",
    top: "auto",
    left: "auto",
    right: "auto",
    bottom: "auto",
    transform: "none",
  };
}

interface BaseNodeProps {
  type: string;
  data: Record<string, unknown>;
  selected?: boolean;
  /** Default: NODE_META[type].color. */
  color?: string;
  /** Default: NODE_META[type].label — override pra rótulos dinâmicos (unmapped) ou com acento. */
  label?: string;
  /** Sizing por nó (min-w/max-w). */
  className?: string;
  children?: ReactNode;
}

/**
 * Card base de todo nó do editor: gradiente translúcido, borda por estado
 * (normal 40% da cor — ~3:1 de contraste, mínimo WCAG não-textual —,
 * selecionado sólido + glow, incompleto tracejado âmbar), header com chip de
 * ícone + rótulo de categoria e badge de incompleto em canal duplo
 * (cor + forma + texto pra leitor de tela).
 */
export function BaseNode({ type, data, selected = false, color, label, className = "", children }: BaseNodeProps) {
  const meta = NODE_META[type];
  const c = color ?? meta?.color ?? "var(--text-secondary)";
  const incomplete = isNodeIncomplete(type, data);
  // Auto-delete configurado no painel: mostrado no card pra dar pra ver, de
  // relance no canvas, quais blocos somem sozinhos.
  const autoDelete = typeof data.auto_delete_seconds === "number"
    ? formatAutoDelete(data.auto_delete_seconds)
    : "";
  // Seleção ganha da borda de incompleto; o dot âmbar continua visível.
  const dashed = Boolean(incomplete) && !selected;

  const border = selected
    ? c
    : dashed
      ? "color-mix(in srgb, var(--amber) 45%, transparent)"
      : `color-mix(in srgb, ${c} 40%, transparent)`;
  const borderHover = selected
    ? c
    : dashed
      ? "color-mix(in srgb, var(--amber) 65%, transparent)"
      : `color-mix(in srgb, ${c} 60%, transparent)`;

  return (
    <div
      className={`rounded-2xl px-4 py-3 relative border transition-[border-color] duration-150 border-(--bn-border) hover:border-(--bn-border-hover) ${dashed ? "border-dashed" : "border-solid"} ${className}`}
      style={
        {
          "--bn-border": border,
          "--bn-border-hover": borderHover,
          background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
          boxShadow: selected ? `0 0 20px -4px ${glowOf(c)}, var(--shadow-md)` : "var(--shadow-md)",
        } as CSSProperties
      }
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${c} 18%, transparent)` }}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={c}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={meta?.icon ?? "M12 5v14M5 12h14"} />
          </svg>
        </div>
        <span className="text-[0.6875rem] font-bold uppercase tracking-wide" style={{ color: c }}>
          {label ?? meta?.label ?? type}
        </span>
        {(autoDelete || incomplete) && (
          <span className="ml-auto pl-2 shrink-0 inline-flex items-center gap-1.5">
            {autoDelete && (
              <span
                className="inline-flex items-center gap-1 text-[0.625rem] font-semibold text-(--text-muted)"
                title={`Mensagem apagada ${autoDelete} após o envio`}
              >
                <svg aria-hidden="true" focusable="false" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                {autoDelete}
              </span>
            )}
            {incomplete && (
              <span className="inline-flex items-center" title={incomplete}>
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--amber)" }} />
                <span className="sr-only">{incomplete}</span>
              </span>
            )}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
