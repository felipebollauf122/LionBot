"use client";

import { useEffect, useId, useState } from "react";
import type { Node } from "@xyflow/react";
import { NODE_META, AUTO_DELETE_TYPES } from "./flow-utils";
import { AutoDeleteConfig } from "./config-forms/auto-delete-config";
import { TriggerConfig } from "./config-forms/trigger-config";
import { TextConfig } from "./config-forms/text-config";
import { ImageConfig } from "./config-forms/image-config";
import { ButtonConfig } from "./config-forms/button-config";
import { DelayConfig } from "./config-forms/delay-config";
import { ConditionConfig } from "./config-forms/condition-config";
import { InputConfig } from "./config-forms/input-config";
import { ActionConfig } from "./config-forms/action-config";
import { VideoConfig } from "./config-forms/video-config";
import { AudioConfig } from "./config-forms/audio-config";
import { PaymentButtonConfig } from "./config-forms/payment-button-config";
import { UnmappedConfig } from "./config-forms/unmapped-config";
import type { BundleOption, ProductOption, MediaAssetOption } from "./flow-editor";

interface NodeConfigPanelProps {
  node: Node | null;
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  /** Duplica o nó selecionado (quando o editor suporta). */
  onDuplicate?: (nodeId: string) => void;
  /** Todos os nós do fluxo — usado pelo seletor "Ir para no" dos botões. */
  flowNodes?: { id: string; type?: string; data: Record<string, unknown> }[];
  bundles: BundleOption[];
  products: ProductOption[];
  /** Mídias cadastradas na Biblioteca de Mídia do bot — usadas nos seletores de randomização. */
  mediaAssets?: MediaAssetOption[];
  /** Gateways ativos no bot — o nó de pagamento escolhe por qual cobrar. */
  enabledGateways?: string[];
  /** Libera os controles de randomização (owner ou assinante Premium). */
  canRandomize?: boolean;
}

export function NodeConfigPanel({
  node,
  onUpdate,
  onClose,
  onDelete,
  onDuplicate,
  flowNodes = [],
  bundles,
  products,
  mediaAssets = [],
  enabledGateways = [],
  canRandomize = false,
}: NodeConfigPanelProps) {
  const titleId = useId();
  // Exclusão em duas etapas: 1º clique arma a confirmação, 2º clique deleta.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Só a variante mobile (bottom sheet com backdrop) é um dialog modal de
  // verdade — no md/lg o painel convive com o canvas, então nada de aria-modal.
  const [isMobile, setIsMobile] = useState(false);

  const nodeId = node?.id ?? null;

  // Trocou de nó (ou fechou): desarma a confirmação de exclusão.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [nodeId]);

  // Confirmação armada expira sozinha em 3s sem o segundo clique.
  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  // Escape fecha o painel enquanto houver nó selecionado.
  useEffect(() => {
    if (!nodeId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [nodeId, onClose]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!node) return null;

  const handleChange = (data: Record<string, unknown>) => {
    onUpdate(node.id, data);
  };

  const info = NODE_META[node.type ?? ""] ?? { label: "Configuracao", icon: "", color: "var(--text-secondary)" };

  // Gatilho não é deletável (o editor bloqueia); unmapped não faz sentido duplicar.
  const canDelete = node.type !== "trigger";
  const canDuplicate = Boolean(onDuplicate) && node.type !== "trigger" && node.type !== "unmapped";

  // key={node.id}: força remontar o form ao trocar de nó, pra qualquer estado
  // local (ex: toggle de variação de texto) não vazar de um nó pro outro.
  const configForms: Record<string, React.ReactNode> = {
    trigger: <TriggerConfig key={node.id} data={node.data} onChange={handleChange} />,
    text: <TextConfig key={node.id} data={node.data} onChange={handleChange} canRandomize={canRandomize} />,
    image: <ImageConfig key={node.id} data={node.data} onChange={handleChange} mediaAssets={mediaAssets} canRandomize={canRandomize} />,
    button: <ButtonConfig key={node.id} data={node.data} onChange={handleChange} products={products} flowNodes={flowNodes} enabledGateways={enabledGateways} />,
    delay: <DelayConfig key={node.id} data={node.data} onChange={handleChange} />,
    condition: <ConditionConfig key={node.id} data={node.data} onChange={handleChange} />,
    input: <InputConfig key={node.id} data={node.data} onChange={handleChange} />,
    action: <ActionConfig key={node.id} data={node.data} onChange={handleChange} />,
    video: <VideoConfig key={node.id} data={node.data} onChange={handleChange} mediaAssets={mediaAssets} canRandomize={canRandomize} />,
    audio: <AudioConfig key={node.id} data={node.data} onChange={handleChange} />,
    payment_button: <PaymentButtonConfig key={node.id} data={node.data} onChange={handleChange} bundles={bundles} canRandomize={canRandomize} enabledGateways={enabledGateways} />,
    unmapped: <UnmappedConfig key={node.id} data={node.data} onChange={handleChange} />,
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
        role={isMobile ? "dialog" : undefined}
        aria-modal={isMobile ? "true" : undefined}
        aria-labelledby={titleId}
        className={
          // MOBILE: bottom sheet (fixo embaixo, animado).
          // md (768–1024): overlay fixo à direita — se ficasse no flex, o painel
          // espremeria o canvas nessa faixa. `fixed` (e não absolute) porque o
          // pai no flow-editor não é positioned e o editor ocupa 100dvh — o
          // resultado visual é o mesmo, sem depender de mudança lá.
          // lg+: coluna lateral estática no flex do editor.
          "flex flex-col overflow-y-auto z-50 " +
          "fixed inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t border-(--border-default) pb-safe animate-up " +
          "md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:z-30 md:max-h-none md:rounded-none md:border-t-0 md:w-72 md:shadow-xl md:animate-none " +
          "lg:static lg:inset-auto lg:z-auto lg:w-80 lg:shrink-0 lg:shadow-none"
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
      {/* Ambient glow — wrapper relative de altura 0: no lg o painel vira
          `static`, então o absolute precisa de um pai posicionado próprio. */}
      <div className="relative h-0 shrink-0">
        <div
          className="absolute top-0 left-0 right-0 h-20 pointer-events-none"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${info.color} 5%, transparent) 0%, transparent 100%)` }}
        />
      </div>

      {/* Header */}
      <div className="px-4 pt-4 pb-3 relative">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: `color-mix(in srgb, ${info.color} 12%, transparent)`, boxShadow: `0 0 10px -4px ${info.color}` }}
            >
              <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={info.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={info.icon} />
              </svg>
            </div>
            <h3 id={titleId} className="text-foreground font-semibold text-xs tracking-tight">{info.label}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar painel de configuração"
            className="w-11 h-11 md:w-8 md:h-8 shrink-0 rounded-md flex items-center justify-center text-(--text-muted) hover:text-foreground hover:bg-white/6 transition-all"
          >
            <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
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

        {/* Auto-delete — só nos blocos que enviam mensagem; nos outros
            (delay/condição/ação/gatilho) não haveria o que apagar. */}
        {AUTO_DELETE_TYPES.has(node.type ?? "") && (
          <>
            <div className="divider my-4" />
            <AutoDeleteConfig key={node.id} data={node.data} onChange={handleChange} />
          </>
        )}
      </div>

      {/* Ações do bloco (duplicar/excluir) */}
      {(canDuplicate || canDelete) && (
        <div className="px-4 pb-4">
          <div className="divider mb-4" />
          <div className="space-y-2">
            {canDuplicate && (
              <button
                type="button"
                onClick={() => onDuplicate?.(node.id)}
                className="btn-ghost w-full"
              >
                <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                Duplicar bloco
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => {
                  // Duas etapas: 1º clique arma, 2º clique (em até 3s) deleta.
                  if (!confirmingDelete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  onDelete(node.id);
                }}
                className="btn-danger w-full"
                style={
                  confirmingDelete
                    ? {
                        background: "color-mix(in srgb, var(--red) 22%, transparent)",
                        borderColor: "color-mix(in srgb, var(--red) 60%, transparent)",
                        boxShadow: "0 0 18px -4px color-mix(in srgb, var(--red) 70%, transparent)",
                      }
                    : undefined
                }
              >
                <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                {confirmingDelete ? "Confirmar exclusão?" : "Excluir bloco"}
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
