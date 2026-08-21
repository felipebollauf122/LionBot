"use client";

import type { MutableRefObject } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export interface EdgeInteractionHandlers {
  onDelete: (edgeId: string) => void;
  /** Cancela o hide-timeout — chamado ao entrar no próprio botão (que fica
   * numa camada acima do path e "rouba" o mouseleave da aresta). */
  onButtonEnter: () => void;
  onButtonLeave: () => void;
}

interface DeletableEdgeData {
  hovered?: boolean;
}

/**
 * Fábrica do edge customizado — estilo n8n: passar o mouse em cima da linha
 * (ou selecioná-la, pra quem não tem hover — touch/teclado) revela um botão
 * "x" no meio pra remover a conexão sem precisar saber do atalho de teclado.
 *
 * edgeTypes do React Flow precisa de referência ESTÁVEL entre renders (senão
 * a lib avisa/recria handles à toa) — por isso a fábrica recebe um ref
 * sempre-atual com os handlers, criado 1x via useMemo no editor, e lê
 * `handlersRef.current` só na hora do clique/hover.
 */
export function createDeletableEdge(handlersRef: MutableRefObject<EdgeInteractionHandlers>) {
  return function DeletableEdge(props: EdgeProps) {
    const {
      id,
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      style,
      markerEnd,
      label,
      labelStyle,
      labelShowBg,
      labelBgStyle,
      labelBgPadding,
      labelBgBorderRadius,
      selected,
      data,
    } = props;

    const [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    const hovered = Boolean((data as DeletableEdgeData | undefined)?.hovered);
    // Selecionada também revela o botão — cobre quem não tem mouse (toque/teclado).
    const visible = hovered || Boolean(selected);
    // Rótulo semântico (Sim/Não/Pagou/Não pagou) ocupa o centro da aresta —
    // o botão desce um pouco pra não empilhar em cima do texto.
    const buttonY = label ? labelY + 18 : labelY;

    return (
      <>
        <BaseEdge
          path={edgePath}
          labelX={labelX}
          labelY={labelY}
          label={label}
          labelStyle={labelStyle}
          labelShowBg={labelShowBg}
          labelBgStyle={labelBgStyle}
          labelBgPadding={labelBgPadding}
          labelBgBorderRadius={labelBgBorderRadius}
          style={style}
          markerEnd={markerEnd}
        />
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${buttonY}px)`,
              opacity: visible ? 1 : 0,
              pointerEvents: visible ? "all" : "none",
              transition: "opacity 120ms ease",
            }}
            onMouseEnter={() => handlersRef.current.onButtonEnter()}
            onMouseLeave={() => handlersRef.current.onButtonLeave()}
          >
            <button
              type="button"
              aria-label="Remover conexão"
              onClick={(e) => {
                e.stopPropagation();
                handlersRef.current.onDelete(id);
              }}
              className="w-5 h-5 rounded-full flex items-center justify-center text-(--red) hover:bg-(--red-muted) transition"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid color-mix(in srgb, var(--red) 45%, transparent)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              <svg aria-hidden="true" focusable="false" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </EdgeLabelRenderer>
      </>
    );
  };
}
