"use client";

import { NODE_META } from "../flow-utils";
import type { ProductOption } from "../flow-editor";
import { GatewaySelect } from "./gateway-select";

interface ButtonData {
  id?: string;
  text: string;
  action: string;
  value: string;
  product_id?: string;
  sale_type?: string;
  gateway?: string;
  style?: string;
}

interface FlowNodeOption {
  id: string;
  type?: string;
  data: Record<string, unknown>;
}

interface ButtonConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  products: ProductOption[];
  /** Nós do fluxo — alimenta o seletor "Ir para no" (repassado pelo NodeConfigPanel). */
  flowNodes?: FlowNodeOption[];
  /** Gateways ativos no bot — cada botão de pagamento escolhe por qual cobrar. */
  enabledGateways?: string[];
}

const SALE_TYPES: { value: string; label: string }[] = [
  { value: "main", label: "Principal" },
  { value: "orderbump", label: "Order Bump" },
  { value: "upsell", label: "Upsell" },
  { value: "downsell", label: "Downsell" },
];

// Actions que o select conhece — qualquer outra (ex: "next" dos botões
// clonados) ganha uma option própria pra não ser exibida como "Callback".
const KNOWN_ACTIONS = ["callback", "go_to_node", "open_url", "payment"];

// Cor do botão no Telegram (Bot API 8.x+) — não é CSS livre, é um campo
// nativo do inline keyboard limitado pelo próprio Telegram a esses 3
// valores (clientes antigos ignoram e mostram a cor padrão do tema).
const BUTTON_STYLES: { value: string; label: string }[] = [
  { value: "", label: "Padrão (tema do cliente)" },
  { value: "danger", label: "🔴 Vermelho" },
  { value: "success", label: "🟢 Verde" },
  { value: "primary", label: "🔵 Azul" },
];

// Id NUNCA-reutilizável (timestamp + aleatório em base36). O esquema antigo
// (menor btn_N livre) reaproveitava o id de um botão deletado — a edge órfã
// dele reatacava em silêncio no próximo botão criado, roteando pagamento pro
// destino errado.
function genButtonId(): string {
  return `btn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function formatPrice(cents: number, currency: string): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency });
}

// Rótulo amigável de um nó pro seletor "Ir para no".
function nodeOptionLabel(n: FlowNodeOption): string {
  const label = NODE_META[n.type ?? ""]?.label ?? (n.type ?? "Bloco");
  const preview = String(n.data.text ?? n.data.prompt ?? n.data.caption ?? "").trim().slice(0, 30);
  return preview ? `${label} — ${preview}` : label;
}

export function ButtonConfig({ data, onChange, products, flowNodes = [], enabledGateways = [] }: ButtonConfigProps) {
  const text = String(data.text ?? "");
  const rawButtons = (data.buttons ?? []) as ButtonData[];
  // Backfill de ids legados: botão sem id ganha PERMANENTEMENTE btn_idx_N —
  // exatamente a fórmula do handle indexado que o canvas/engine já usam pra
  // ele hoje, então as edges existentes continuam válidas. A lista normalizada
  // é persistida junto com o primeiro onChange do nó (via commit abaixo).
  const needsBackfill = rawButtons.some((b) => !b.id);
  const buttons = needsBackfill
    ? rawButtons.map((b, i) => (b.id ? b : { ...b, id: `btn_idx_${i}` }))
    : rawButtons;
  const hasPaymentButton = buttons.some((b) => b.action === "payment");
  const timeoutMinutes = Number(data.payment_timeout_minutes ?? 15);

  // Toda alteração do nó passa por aqui pra garantir que o backfill de ids
  // seja gravado mesmo quando o campo tocado não é a lista de botões.
  const commit = (patch: Record<string, unknown>) => {
    onChange(needsBackfill ? { ...data, buttons, ...patch } : { ...data, ...patch });
  };

  const updateButton = (index: number, field: keyof ButtonData, value: string) => {
    const updated = [...buttons];
    updated[index] = { ...updated[index], [field]: value };
    commit({ buttons: updated });
  };

  const addButton = () => {
    // value nunca nasce vazio: a engine roteia callback/go_to_node pelo
    // btn.value CRU (server/src/engine/nodes/button.ts) — dois botões com
    // value "" geram o mesmo callback_data e ficam indistinguíveis em
    // runtime (e no canvas, já que o handle do botão também deriva de value).
    const id = genButtonId();
    commit({
      buttons: [...buttons, { id, text: "Novo Botao", action: "callback", value: id }],
    });
  };

  const removeButton = (index: number) => {
    commit({ buttons: buttons.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="input-label">Mensagem</label>
        <textarea
          value={text}
          onChange={(e) => commit({ text: e.target.value })}
          rows={3}
          className="input resize-none"
        />
      </div>
      <div>
        <label className="input-label">Botoes</label>
        {buttons.map((btn, i) => (
          <div
            key={i}
            className="rounded-xl p-3 mb-2 space-y-2"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: btn.action === "payment"
                ? "1px solid color-mix(in srgb, var(--amber) 18%, transparent)"
                : "1px solid var(--border-subtle)",
            }}
          >
            <input
              type="text"
              value={btn.text}
              onChange={(e) => updateButton(i, "text", e.target.value)}
              placeholder="Texto do botao"
              className="input py-2! text-xs!"
            />
            <div className="flex items-center gap-2">
              <select
                value={btn.action}
                onChange={(e) => updateButton(i, "action", e.target.value)}
                className="input flex-1 py-2! text-xs!"
              >
                {/* Botões clonados vêm com action "next" — sem essa option o
                    select mostrava "Callback" e mentia sobre o comportamento. */}
                {!KNOWN_ACTIONS.includes(btn.action) && (
                  <option value={btn.action}>Seguir fluxo (clonado)</option>
                )}
                <option value="callback">Callback</option>
                <option value="go_to_node">Ir para no</option>
                <option value="open_url">Abrir URL</option>
                <option value="payment">💳 Gerar Pagamento (Pix)</option>
              </select>
              <button
                onClick={() => removeButton(i)}
                aria-label={`Remover botão ${btn.text}`}
                className="w-11 h-11 md:w-7 md:h-7 shrink-0 rounded-lg flex items-center justify-center text-(--red) hover:bg-(--red-muted) transition"
              >
                <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <select
              value={btn.style ?? ""}
              onChange={(e) => updateButton(i, "style", e.target.value)}
              className="input py-2! text-xs!"
            >
              {BUTTON_STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            {btn.action === "payment" ? (
              <div className="space-y-2">
                <select
                  value={btn.product_id ?? ""}
                  onChange={(e) => updateButton(i, "product_id", e.target.value)}
                  className="input py-2! text-xs!"
                >
                  <option value="">Selecione um produto...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatPrice(p.price, p.currency)}
                    </option>
                  ))}
                </select>
                {products.length === 0 && (
                  <p className="text-(--amber) text-[0.6875rem] leading-snug">
                    Nenhum produto encontrado. Crie um na aba &quot;Produtos&quot;.
                  </p>
                )}
                <select
                  value={btn.sale_type ?? "main"}
                  onChange={(e) => updateButton(i, "sale_type", e.target.value)}
                  className="input py-2! text-xs!"
                >
                  {SALE_TYPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {/* Gateway POR BOTÃO: dá pra ter "Pagar com PIX" e "Pagar com
                    cripto" pro mesmo produto, lado a lado no mesmo nó. */}
                <GatewaySelect
                  value={btn.gateway ?? ""}
                  onChange={(gateway) => updateButton(i, "gateway", gateway)}
                  enabledGateways={enabledGateways}
                  compact
                />
                <p className="text-(--amber) text-[0.6875rem] leading-snug">
                  Gera a cobranca ao clicar. Conecte os handles <strong>Pagou</strong> / <strong>Nao Pagou</strong> deste botao no canvas pra continuar o fluxo.
                </p>
              </div>
            ) : btn.action === "go_to_node" ? (
              // Seletor de blocos do fluxo — sem exigir que o usuário digite o
              // id interno do nó. Fallback pro input livre se a lista não veio.
              flowNodes.length > 0 ? (
                <select
                  value={btn.value}
                  onChange={(e) => updateButton(i, "value", e.target.value)}
                  className="input py-2! text-xs!"
                >
                  <option value="">Selecione um bloco...</option>
                  {btn.value && !flowNodes.some((n) => n.id === btn.value) && (
                    <option value={btn.value}>(bloco removido do fluxo)</option>
                  )}
                  {flowNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {nodeOptionLabel(n)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={btn.value}
                  onChange={(e) => updateButton(i, "value", e.target.value)}
                  placeholder="Id do bloco de destino"
                  className="input py-2! text-xs!"
                />
              )
            ) : (
              <input
                type="text"
                value={btn.value}
                onChange={(e) => updateButton(i, "value", e.target.value)}
                placeholder={btn.action === "open_url" ? "https://..." : "Valor"}
                className="input py-2! text-xs!"
              />
            )}
          </div>
        ))}
        <button
          onClick={addButton}
          className="w-full py-2 rounded-xl text-xs font-medium transition-all text-(--text-muted) hover:text-(--text-secondary) hover:bg-white/4"
          style={{
            border: "1px dashed var(--border-default)",
          }}
        >
          + Adicionar Botao
        </button>
      </div>

      {hasPaymentButton && (
        <div>
          <label className="input-label">Timeout &quot;Nao Pagou&quot; (minutos)</label>
          <input
            type="number"
            min={0}
            max={1440}
            value={timeoutMinutes}
            onChange={(e) => {
              // 0 é válido e DESATIVA o timeout (a engine só agenda quando
              // > 0) — nada de `|| 15`, que convertia 0 em 15 em silêncio.
              // Campo vazio volta pro padrão 15.
              const raw = e.target.value;
              const next = raw === "" ? 15 : Math.min(1440, Math.max(0, parseInt(raw, 10) || 0));
              commit({ payment_timeout_minutes: next });
            }}
            className="input"
          />
          <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-1">
            Tempo ate disparar o fluxo &quot;Nao Pagou&quot; de qualquer botao de pagamento desta mensagem. Use 0 para desativar.
          </p>
        </div>
      )}
    </div>
  );
}
