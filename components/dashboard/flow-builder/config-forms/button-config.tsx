"use client";

import type { ProductOption } from "../flow-editor";

interface ButtonData {
  id?: string;
  text: string;
  action: string;
  value: string;
  product_id?: string;
  sale_type?: string;
}

interface ButtonConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  products: ProductOption[];
}

const SALE_TYPES: { value: string; label: string }[] = [
  { value: "main", label: "Principal" },
  { value: "orderbump", label: "Order Bump" },
  { value: "upsell", label: "Upsell" },
  { value: "downsell", label: "Downsell" },
];

// gera um id estável (btn_N) que nunca colide com os já existentes —
// mesmo padrão usado pra custom_buttons em payment-button-config.tsx.
function genButtonId(existing: ButtonData[]): string {
  const used = new Set(existing.map((b) => b.id).filter(Boolean));
  let n = 0;
  while (used.has(`btn_${n}`)) n++;
  return `btn_${n}`;
}

function formatPrice(cents: number, currency: string): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency });
}

export function ButtonConfig({ data, onChange, products }: ButtonConfigProps) {
  const text = String(data.text ?? "");
  const buttons = (data.buttons ?? []) as ButtonData[];
  const hasPaymentButton = buttons.some((b) => b.action === "payment");
  const timeoutMinutes = Number(data.payment_timeout_minutes ?? 15);

  const updateButton = (index: number, field: keyof ButtonData, value: string) => {
    const updated = [...buttons];
    const current = { ...updated[index], [field]: value };
    // botao criado antes dessa feature existir (ou legado) nao tem id —
    // ganha um agora, so quando vira pagamento (id so importa pro roteamento
    // pagou/nao-pagou; pros demais actions o handle generico segue igual).
    if (field === "action" && value === "payment" && !current.id) {
      current.id = genButtonId(buttons);
    }
    updated[index] = current;
    onChange({ ...data, buttons: updated });
  };

  const addButton = () => {
    onChange({
      ...data,
      buttons: [...buttons, { id: genButtonId(buttons), text: "Novo Botao", action: "callback", value: "" }],
    });
  };

  const removeButton = (index: number) => {
    onChange({ ...data, buttons: buttons.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="input-label">Mensagem</label>
        <textarea
          value={text}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
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
              border: btn.action === "payment" ? "1px solid rgba(255,184,0,0.18)" : "1px solid var(--border-subtle)",
            }}
          >
            <input
              type="text"
              value={btn.text}
              onChange={(e) => updateButton(i, "text", e.target.value)}
              placeholder="Texto do botao"
              className="input py-2! text-xs!"
            />
            <div className="flex gap-2">
              <select
                value={btn.action}
                onChange={(e) => updateButton(i, "action", e.target.value)}
                className="input flex-1 py-2! text-xs!"
              >
                <option value="callback">Callback</option>
                <option value="go_to_node">Ir para no</option>
                <option value="open_url">Abrir URL</option>
                <option value="payment">💳 Gerar Pagamento (Pix)</option>
              </select>
              <button
                onClick={() => removeButton(i)}
                className="px-2 py-1 text-(--red) text-xs rounded-lg hover:bg-(--red-muted) transition"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

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
                  <p className="text-(--amber) text-[10px]" style={{ opacity: 0.7 }}>
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
                <p className="text-(--amber) text-[10px]" style={{ opacity: 0.8 }}>
                  Gera um Pix ao clicar. Conecte os handles <strong>Pagou</strong> / <strong>Nao Pagou</strong> deste botao no canvas pra continuar o fluxo.
                </p>
              </div>
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
            min={1}
            max={1440}
            value={timeoutMinutes}
            onChange={(e) => onChange({ ...data, payment_timeout_minutes: Number(e.target.value) || 15 })}
            className="input"
          />
          <p className="text-(--text-muted) text-[10px] mt-1" style={{ opacity: 0.7 }}>
            Tempo ate disparar o fluxo &quot;Nao Pagou&quot; de qualquer botao de pagamento desta mensagem. Use 0 para desativar.
          </p>
        </div>
      )}
    </div>
  );
}
