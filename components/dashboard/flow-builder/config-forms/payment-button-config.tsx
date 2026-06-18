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

  return (
    <div className="space-y-3">
      <div>
        <label className="input-label">Tipo de Venda</label>
        <select
          value={saleType}
          onChange={(e) => onChange({ ...data, sale_type: e.target.value })}
          className="input"
        >
          <option value="main">Principal</option>
          <option value="upsell">Upsell</option>
          <option value="downsell">Downsell</option>
          <option value="orderbump">Order Bump</option>
        </select>
        <p className="text-(--text-muted) text-[10px] mt-1" style={{ opacity: 0.7 }}>
          Classifica as vendas deste botão nas Análises (Upsell / Downsell / Order Bump).
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
