"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export function PaymentButtonNode({ data, selected }: NodeProps) {
  const bundleId = String(data.bundle_id ?? "");
  const saleType = String(data.sale_type ?? "main");
  const isOffer = saleType === "upsell" || saleType === "downsell";
  // botões de recusa/extras (cada um vira um handle de saída próprio).
  // Padrão se não configurado: só "Recusar".
  const offerButtons = (
    isOffer
      ? (Array.isArray(data.accept_reject_buttons) && data.accept_reject_buttons.length > 0
          ? (data.accept_reject_buttons as { id?: string; label?: string }[])
          : [{ id: "reject", label: "Recusar" }])
      : []
  ).filter((b) => String(b.id ?? "") !== "accept");

  return (
    <div
      className="rounded-2xl px-4 py-3 min-w-50 max-w-70 relative"
      style={{
        background: "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.015) 100%)",
        border: `1px solid ${selected ? "var(--amber)" : "rgba(255,184,0,0.18)"}`,
        boxShadow: selected ? "0 0 20px -4px var(--amber-glow), var(--shadow-md)" : "var(--shadow-md)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "var(--amber)", width: 10, height: 10, border: "2px solid var(--bg-root)" }} />
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--amber) 15%, transparent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
        </div>
        <span className="text-(--amber) text-[10px] font-bold uppercase tracking-wider">Pagamento</span>
      </div>
      <div
        className="rounded-lg px-3 py-2 text-xs text-center font-medium"
        style={{
          background: bundleId
            ? "linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent) 4%, transparent))"
            : "linear-gradient(135deg, color-mix(in srgb, var(--amber) 10%, transparent), color-mix(in srgb, var(--amber) 4%, transparent))",
          border: bundleId ? "1px solid color-mix(in srgb, var(--accent) 15%, transparent)" : "1px solid rgba(255,184,0,0.15)",
          color: bundleId ? "var(--accent)" : "var(--amber)",
        }}
      >
        {bundleId ? (
          <span className="flex items-center justify-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            Conjunto configurado
          </span>
        ) : (
          <span className="flex items-center justify-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
            </svg>
            Selecione um conjunto
          </span>
        )}
      </div>
      {/* Upsell/Downsell: clicar no produto = Aceitar (segue por "Pagou").
          "Recusar" e extras viram handles próprios pra ramificar. */}
      {isOffer && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 justify-center px-1">
          {offerButtons.map((b) => (
            <div key={String(b.id)} className="flex flex-col items-center gap-0.5">
              <Handle type="source" position={Position.Bottom} id={String(b.id)} style={{ position: "relative", background: "var(--purple)", width: 10, height: 10, border: "2px solid var(--bg-root)", transform: "none" }} />
              <span className="text-(--purple) text-[9px] font-bold max-w-16 truncate">{String(b.label ?? b.id)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between mt-2.5 px-2">
        <div className="flex flex-col items-center gap-0.5">
          <Handle type="source" position={Position.Bottom} id="paid" style={{ position: "relative", background: "var(--accent)", width: 10, height: 10, border: "2px solid var(--bg-root)", transform: "none" }} />
          <span className="text-(--accent) text-[9px] font-bold">{isOffer ? "Aceitou/Pagou" : "Pagou"}</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <Handle type="source" position={Position.Bottom} id="not_paid" style={{ position: "relative", background: "var(--red)", width: 10, height: 10, border: "2px solid var(--bg-root)", transform: "none" }} />
          <span className="text-(--red) text-[9px] font-bold">Nao Pagou</span>
        </div>
      </div>
    </div>
  );
}
