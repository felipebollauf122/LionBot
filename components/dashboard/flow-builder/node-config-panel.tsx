"use client";

import type { Node } from "@xyflow/react";
import { TriggerConfig } from "./config-forms/trigger-config";
import { TextConfig } from "./config-forms/text-config";
import { ImageConfig } from "./config-forms/image-config";
import { ButtonConfig } from "./config-forms/button-config";
import { DelayConfig } from "./config-forms/delay-config";
import { ConditionConfig } from "./config-forms/condition-config";
import { InputConfig } from "./config-forms/input-config";
import { ActionConfig } from "./config-forms/action-config";
import { VideoConfig } from "./config-forms/video-config";
import { PaymentButtonConfig } from "./config-forms/payment-button-config";
import { UnmappedConfig } from "./config-forms/unmapped-config";
import type { BundleOption, ProductOption } from "./flow-editor";

interface NodeConfigPanelProps {
  node: Node | null;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  bundles: BundleOption[];
  products: ProductOption[];
}

const nodeInfo: Record<string, { label: string; icon: string; color: string }> = {
  trigger: { label: "Gatilho", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", color: "var(--accent)" },
  text: { label: "Texto", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z", color: "var(--cyan)" },
  image: { label: "Imagem", icon: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z", color: "var(--cyan)" },
  video: { label: "Video", icon: "M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z", color: "var(--cyan)" },
  button: { label: "Botoes", icon: "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18", color: "var(--cyan)" },
  delay: { label: "Delay", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2", color: "var(--text-secondary)" },
  condition: { label: "Condicao", icon: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5", color: "var(--amber)" },
  input: { label: "Input", icon: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z", color: "var(--purple)" },
  action: { label: "Acao", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", color: "var(--text-secondary)" },
  payment_button: { label: "Pagamento", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", color: "var(--amber)" },
  unmapped: { label: "Nao mapeado", icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01", color: "var(--amber)" },
};

export function NodeConfigPanel({ node, onUpdate, onClose, onDelete, bundles, products }: NodeConfigPanelProps) {
  if (!node) return null;

  const handleChange = (data: Record<string, unknown>) => {
    onUpdate(node.id, data);
  };

  const info = nodeInfo[node.type ?? ""] ?? { label: "Configuracao", icon: "", color: "var(--text-secondary)" };

  const configForms: Record<string, React.ReactNode> = {
    trigger: <TriggerConfig data={node.data} onChange={handleChange} />,
    text: <TextConfig data={node.data} onChange={handleChange} />,
    image: <ImageConfig data={node.data} onChange={handleChange} />,
    button: <ButtonConfig data={node.data} onChange={handleChange} products={products} />,
    delay: <DelayConfig data={node.data} onChange={handleChange} />,
    condition: <ConditionConfig data={node.data} onChange={handleChange} />,
    input: <InputConfig data={node.data} onChange={handleChange} />,
    action: <ActionConfig data={node.data} onChange={handleChange} />,
    video: <VideoConfig data={node.data} onChange={handleChange} />,
    payment_button: <PaymentButtonConfig data={node.data} onChange={handleChange} bundles={bundles} />,
    unmapped: <UnmappedConfig data={node.data} onChange={handleChange} />,
  };

  return (
    <>
      {/* Mobile: backdrop por trás do sheet (toca pra fechar) */}
      <button
        aria-label="Fechar"
        onClick={onClose}
        className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in"
      />
      <div
        className={
          // MOBILE: bottom sheet (fixo embaixo, animado). DESKTOP: coluna lateral.
          "flex flex-col overflow-y-auto relative z-50 " +
          "fixed inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t border-(--border-default) pb-safe animate-up " +
          "md:static md:z-auto md:inset-auto md:bottom-auto md:max-h-none md:rounded-none md:border-t-0 md:w-72 lg:w-80 md:shrink-0 md:animate-none"
        }
        style={{
          background: "linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-root) 100%)",
          borderLeft: "1px solid var(--border-subtle)",
        }}
      >
        {/* grab handle (só mobile) */}
        <div className="md:hidden sticky top-0 z-10 pt-3 pb-1 flex justify-center bg-(--bg-surface)/90 backdrop-blur-md">
          <div className="w-10 h-1 rounded-full bg-white/15" />
        </div>
      {/* Ambient glow */}
      <div
        className="absolute top-0 left-0 right-0 h-20 pointer-events-none"
        style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${info.color} 5%, transparent) 0%, transparent 100%)` }}
      />

      {/* Header */}
      <div className="px-4 pt-4 pb-3 relative">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: `color-mix(in srgb, ${info.color} 12%, transparent)`, boxShadow: `0 0 10px -4px ${info.color}` }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={info.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={info.icon} />
              </svg>
            </div>
            <h3 className="text-foreground font-semibold text-xs tracking-tight">{info.label}</h3>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center text-(--text-muted) hover:text-foreground hover:bg-white/6 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Separator */}
        <div className="absolute bottom-0 left-3 right-3 h-px bg-linear-to-r from-transparent via-(--border-default) to-transparent" />
      </div>

      {/* Config form */}
      <div className="flex-1 px-4 pt-4 pb-4">
        {configForms[node.type ?? ""]}
      </div>

      {/* Delete button */}
      <div className="px-4 pb-4">
        <div className="divider mb-4" />
        <button
          onClick={() => onDelete(node.id)}
          className="btn-danger w-full"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          Excluir No
        </button>
      </div>
      </div>
    </>
  );
}
