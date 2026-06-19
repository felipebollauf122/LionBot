"use client";

import type { BundleOption } from "../flow-editor";

interface PaymentButtonConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  bundles: BundleOption[];
}

export function PaymentButtonConfig({ data, onChange, bundles }: PaymentButtonConfigProps) {
  const bundleId = String(data.bundle_id ?? "");
  const timeoutMinutes = Number(data.payment_timeout_minutes ?? 15);
  const saleType = String(data.sale_type ?? "main");

  const saleTypes: { value: string; label: string; hint: string; color: string }[] = [
    { value: "main", label: "Principal", hint: "Venda principal do funil", color: "var(--accent)" },
    { value: "orderbump", label: "Order Bump", hint: "Oferta extra logo após a compra", color: "var(--amber)" },
    { value: "upsell", label: "Upsell", hint: "Oferta MAIS cara depois da compra", color: "var(--cyan)" },
    { value: "downsell", label: "Downsell", hint: "Oferta mais barata se recusar o upsell", color: "var(--purple)" },
  ];
  const current = saleTypes.find((s) => s.value === saleType) ?? saleTypes[0];

  return (
    <div className="space-y-3">
      {/* Tipo de venda — destacado: define como esta venda aparece nas Análises */}
      <div
        className="rounded-xl p-3"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${current.color} 8%, transparent), color-mix(in srgb, ${current.color} 2%, transparent))`,
          border: `1px solid color-mix(in srgb, ${current.color} 28%, transparent)`,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={current.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" /><path d="M18 9l-5 5-3-3-4 4" />
          </svg>
          <label className="input-label mb-0!" style={{ color: current.color }}>Tipo de Venda</label>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {saleTypes.map((s) => {
            const active = s.value === saleType;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => onChange({ ...data, sale_type: s.value })}
                className="text-left px-2.5 py-2 rounded-lg border transition-all active:scale-[0.98]"
                style={{
                  background: active ? `color-mix(in srgb, ${s.color} 16%, transparent)` : "rgba(255,255,255,0.02)",
                  borderColor: active ? `color-mix(in srgb, ${s.color} 55%, transparent)` : "var(--border-subtle)",
                  boxShadow: active ? `0 0 12px -5px ${s.color}` : "none",
                }}
              >
                <span className="block text-xs font-semibold" style={{ color: active ? s.color : "var(--text-secondary)" }}>{s.label}</span>
                <span className="block text-[9px] leading-tight mt-0.5 text-(--text-muted)">{s.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] mt-2 text-(--text-muted)" style={{ opacity: 0.85 }}>
          Define como as vendas deste botão aparecem no card <strong>Upsell / Downsell / Order Bump</strong> das Análises. Não muda o fluxo — só a classificação.
        </p>
      </div>

      <div>
        <label className="input-label">Conjunto de Produtos</label>
        <select
          value={bundleId}
          onChange={(e) => onChange({ ...data, bundle_id: e.target.value })}
          className="input"
        >
          <option value="">Selecione um conjunto...</option>
          {bundles.map((bundle) => (
            <option key={bundle.id} value={bundle.id}>
              {bundle.name}
            </option>
          ))}
        </select>
        {bundles.length === 0 && (
          <p className="text-(--amber) text-[10px] mt-1.5" style={{ opacity: 0.7 }}>
            Nenhum conjunto encontrado. Crie um na aba &quot;Conjuntos&quot;.
          </p>
        )}
      </div>
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
          Tempo ate disparar o fluxo &quot;Nao Pagou&quot;. Use 0 para desativar.
        </p>
      </div>
      <div
        className="rounded-xl p-3 text-[11px]"
        style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 6%, transparent), color-mix(in srgb, var(--amber) 2%, transparent))",
          border: "1px solid rgba(255,184,0,0.1)",
          color: "var(--amber)",
          opacity: 0.75,
        }}
      >
        <strong>Pagou:</strong> Dispara imediatamente quando o pagamento e confirmado.
        <br />
        <strong>Nao Pagou:</strong> Dispara apos o timeout se o pagamento nao for confirmado. Conecte um delay ou mensagem de lembrete.
      </div>
    </div>
  );
}
