"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ButtonData { id?: string; text: string; action: string; value: string; product_id?: string; }

export function ButtonNode({ data, selected }: NodeProps) {
  const text = String(data.text ?? "Mensagem com botoes");
  const buttons = (data.buttons ?? []) as ButtonData[];
  const paymentButtons = buttons
    .map((btn, i) => ({ btn, btnId: btn.id ?? `btn_idx_${i}` }))
    .filter(({ btn }) => btn.action === "payment");

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
      <div className="space-y-1">
        {buttons.map((btn, i) => (
          <div
            key={i}
            className="rounded-lg px-2.5 py-1.5 text-xs text-center font-medium flex items-center justify-center gap-1"
            style={{
              background: btn.action === "payment" ? "color-mix(in srgb, var(--amber) 8%, transparent)" : "color-mix(in srgb, var(--cyan) 6%, transparent)",
              border: btn.action === "payment" ? "1px solid color-mix(in srgb, var(--amber) 18%, transparent)" : "1px solid color-mix(in srgb, var(--cyan) 10%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            {btn.action === "payment" && <span className="text-(--amber)">$</span>}
            <span>{btn.text}</span>
          </div>
        ))}
      </div>

      {/* Botoes de pagamento: cada um ganha seu proprio par de handles
          (pagou/nao pagou), namespaced pelo id do botao, pra rotear
          independente quando ha mais de um botao de pagamento no no. */}
      {paymentButtons.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center mt-2.5 px-1">
          {paymentButtons.map(({ btnId }) => (
            <div key={btnId} className="flex items-center gap-2.5">
              <div className="flex flex-col items-center gap-0.5">
                <Handle type="source" position={Position.Bottom} id={`paid:${btnId}`} style={{ position: "relative", background: "var(--accent)", width: 10, height: 10, border: "2px solid var(--bg-root)", transform: "none" }} />
                <span className="text-(--accent) text-[9px] font-bold">Pagou</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <Handle type="source" position={Position.Bottom} id={`not_paid:${btnId}`} style={{ position: "relative", background: "var(--red)", width: 10, height: 10, border: "2px solid var(--bg-root)", transform: "none" }} />
                <span className="text-(--red) text-[9px] font-bold">Nao Pagou</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: "var(--cyan)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
    </div>
  );
}
