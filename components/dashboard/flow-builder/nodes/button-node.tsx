"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle, buttonHandleIds } from "../flow-utils";
import { BaseNode, inlineHandleStyle } from "./base-node";

interface ButtonData { id?: string; text: string; action: string; value: string; product_id?: string; style?: string; }

// Cor real que o Telegram renderiza pro botão (Bot API 8.x "style"), fixa
// (não segue o tema do app) pra bater com o que o cliente vê de verdade.
const STYLE_COLORS: Record<string, string> = { danger: "#ff3b30", success: "#34c759", primary: "#0a84ff" };
const STYLE_NAMES: Record<string, string> = { danger: "Vermelho", success: "Verde", primary: "Azul" };

const COLOR = NODE_META.button.color;

export function ButtonNode({ data, selected }: NodeProps) {
  const text = String(data.text ?? "").trim();
  const buttons = (data.buttons ?? []) as ButtonData[];

  return (
    <BaseNode type="button" data={data} selected={selected} label="Botões" className="min-w-50 max-w-70">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />
      {text ? (
        <p className="text-(--text-secondary) text-sm mb-2">{text.length > 40 ? text.slice(0, 40) + "..." : text}</p>
      ) : (
        <p className="text-(--text-muted) text-sm italic mb-2">Sem texto</p>
      )}

      {/* Cada botao e seu proprio card — quando e de pagamento, o par de
          handles (pagou/nao pagou) fica DENTRO do mesmo card, colado embaixo
          do texto, pra nunca deixar dúvida de qual botao aquele handle
          pertence. Botão comum ganha um handle source próprio na altura do
          seu card (arestas de fluxos clonados apontam pra ele — sem esse
          handle elas ficavam invisíveis no editor). */}
      {buttons.length === 0 ? (
        <p className="text-(--text-muted) text-xs italic">Sem botões</p>
      ) : (
        <div className="space-y-1.5">
          {buttons.map((btn, i) => {
            const isPayment = btn.action === "payment";
            // Única fonte de verdade dos ids de handle deste botão
            // (flow-utils.ts) — validSourceHandles (poda) e o rename de
            // aresta em flow-editor.tsx dependem de bater exatamente com o
            // que é renderizado aqui, senão uma aresta editada não é nem
            // renomeada nem podada, e sobra órfã pra sempre.
            const handles = buttonHandleIds(btn, i);
            const styleColor = btn.style ? STYLE_COLORS[btn.style] : undefined;
            return (
              <div
                key={i}
                className={`rounded-lg relative ${isPayment ? "overflow-hidden" : ""}`}
                style={{
                  border: isPayment
                    ? "1px solid color-mix(in srgb, var(--amber) 30%, transparent)"
                    : `1px solid color-mix(in srgb, ${COLOR} 20%, transparent)`,
                  background: isPayment
                    ? "color-mix(in srgb, var(--amber) 5%, transparent)"
                    : `color-mix(in srgb, ${COLOR} 6%, transparent)`,
                }}
              >
                <div
                  className="px-2.5 py-1.5 text-xs font-medium flex items-center justify-center gap-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {isPayment && (
                    <svg
                      aria-hidden="true"
                      focusable="false"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--amber)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                    </svg>
                  )}
                  {styleColor && (
                    <>
                      <span
                        aria-hidden="true"
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: styleColor }}
                        title="Cor do botão no Telegram"
                      />
                      <span className="sr-only">{STYLE_NAMES[btn.style ?? ""]}</span>
                    </>
                  )}
                  <span className="min-w-0 max-w-full truncate">{btn.text}</span>
                </div>
                {!isPayment && btn.action !== "open_url" && (
                  // Absoluto na borda direita do NÓ (card + px-4 do BaseNode =
                  // 28px até o centro do ponto), alinhado à altura do botão:
                  // a aresta sai visivelmente DESTE botão, estilo n8n.
                  // "Abrir URL" fica de fora: a engine nunca gera callback_data
                  // pra esse botão (o Telegram abre a URL direto no cliente),
                  // então oferecer um handle aqui só criaria conexão morta.
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={handles[0]}
                    style={{
                      ...handleStyle(COLOR),
                      position: "absolute",
                      left: "auto",
                      right: -28,
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  />
                )}
                {isPayment && (
                  <div
                    className="flex items-start justify-center gap-x-3 pb-1"
                    style={{ borderTop: "1px dashed color-mix(in srgb, var(--amber) 30%, transparent)" }}
                  >
                    <div className="flex flex-col items-center">
                      <Handle
                        type="source"
                        position={Position.Bottom}
                        id={handles[0]}
                        style={inlineHandleStyle("var(--accent)")}
                      />
                      <span className="text-(--accent) text-[0.6875rem] font-semibold leading-none">Pagou</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <Handle
                        type="source"
                        position={Position.Bottom}
                        id={handles[1]}
                        style={inlineHandleStyle("var(--red)")}
                      />
                      <span className="text-(--red) text-[0.6875rem] font-semibold leading-none">Não pagou</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Saída sequencial genérica do nó (sem id) — fluxo segue se nenhum
          botão for clicado / mensagens em sequência. */}
      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
