"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ButtonData { id?: string; text: string; action: string; value: string; product_id?: string; style?: string; }

// Cor real que o Telegram renderiza pro botão (Bot API 8.x "style"), fixa
// (não segue o tema do app) pra bater com o que o cliente vê de verdade.
const STYLE_COLORS: Record<string, string> = { danger: "#ff3b30", success: "#34c759", primary: "#0a84ff" };

export function ButtonNode({ data, selected }: NodeProps) {
  const text = String(data.text ?? "Mensagem com botoes");
  const buttons = (data.buttons ?? []) as ButtonData[];

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-50 max-w-70 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--cyan)" : "color-mix(in srgb, var(--cyan) 15%, transparent)"}`,
        boxShadow: selected ? "0 0 20px -4px var(--cyan-glow), var(--shadow-md)" : "var(--shadow-md)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "var(--cyan)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--cyan) 15%, transparent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
          </svg>
        </div>
        <span className="text-(--cyan) text-[10px] font-bold uppercase tracking-wider">Botoes</span>
      </div>
      <p className="text-(--text-secondary) text-sm mb-2">{text.length > 40 ? text.slice(0, 40) + "..." : text}</p>

      {/* Cada botao e seu proprio card — quando e de pagamento, o par de
          handles (pagou/nao pagou) fica DENTRO do mesmo card, colado embaixo
          do texto, pra nunca deixar dúvida de qual botao aquele handle
          pertence (antes ficavam todos juntos numa faixa no rodape do no,
          sem nenhum vinculo visual com o botao correspondente). */}
      <div className="space-y-1.5">
        {buttons.map((btn, i) => {
          const isPayment = btn.action === "payment";
          const btnId = btn.id ?? `btn_idx_${i}`;
          const styleColor = btn.style ? STYLE_COLORS[btn.style] : undefined;
          return (
            <div
              key={i}
              className="rounded-lg overflow-hidden"
              style={{
                border: isPayment
                  ? "1px solid color-mix(in srgb, var(--amber) 25%, transparent)"
                  : "1px solid color-mix(in srgb, var(--cyan) 10%, transparent)",
                background: isPayment
                  ? "color-mix(in srgb, var(--amber) 5%, transparent)"
                  : "color-mix(in srgb, var(--cyan) 6%, transparent)",
              }}
            >
              <div className="px-2.5 py-1.5 text-xs text-center font-medium flex items-center justify-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                {isPayment && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                  </svg>
                )}
                {styleColor && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: styleColor }} title="Cor do botão no Telegram" />
                )}
                <span>{btn.text}</span>
              </div>
              {isPayment && (
                <div
                  className="flex items-center justify-center gap-6 pt-1 pb-1.5"
                  style={{ borderTop: "1px dashed color-mix(in srgb, var(--amber) 22%, transparent)" }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <Handle type="source" position={Position.Bottom} id={`paid:${btnId}`} style={{ position: "relative", background: "var(--accent)", width: 9, height: 9, border: "2px solid var(--bg-root)", transform: "none" }} />
                    <span className="text-(--accent) text-[8px] font-bold leading-none uppercase tracking-wide">Pagou</span>
                  </div>
                  <div className="flex flex-col items-center gap-0.5">
                    <Handle type="source" position={Position.Bottom} id={`not_paid:${btnId}`} style={{ position: "relative", background: "var(--red)", width: 9, height: 9, border: "2px solid var(--bg-root)", transform: "none" }} />
                    <span className="text-(--red) text-[8px] font-bold leading-none uppercase tracking-wide">Nao Pagou</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: "var(--cyan)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
