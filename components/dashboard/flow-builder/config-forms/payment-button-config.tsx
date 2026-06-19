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

  // ── Botões Aceitar/Recusar (só upsell/downsell) ──
  const isOffer = saleType === "upsell" || saleType === "downsell";
  const layout = String(data.button_layout ?? "vertical");
  type OfferBtn = { id: string; label: string };
  const offerButtons: OfferBtn[] =
    Array.isArray(data.accept_reject_buttons) && (data.accept_reject_buttons as OfferBtn[]).length > 0
      ? (data.accept_reject_buttons as OfferBtn[])
      : [{ id: "reject", label: "Recusar" }];

  const setButtons = (next: OfferBtn[]) => onChange({ ...data, accept_reject_buttons: next });
  const renameButton = (i: number, label: string) => {
    const next = offerButtons.map((b, idx) => (idx === i ? { ...b, label } : b));
    setButtons(next);
  };
  const addButton = () => {
    // id estável e único (reject já existe por padrão; extras viram btn_N)
    const used = new Set(offerButtons.map((b) => b.id));
    let n = 0;
    while (used.has(`btn_${n}`)) n++;
    setButtons([...offerButtons, { id: `btn_${n}`, label: "Novo botão" }]);
  };
  const removeButton = (i: number) => {
    const next = offerButtons.filter((_, idx) => idx !== i);
    setButtons(next.length > 0 ? next : [{ id: "reject", label: "Recusar" }]);
  };

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

      {/* Botões Aceitar/Recusar — só upsell/downsell */}
      {isOffer && (
        <div
          className="rounded-xl p-3 space-y-2.5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}
        >
          <div>
            <label className="input-label mb-0!">Botões de oferta</label>
            <p className="text-[10px] text-(--text-muted) mt-0.5 mb-2" style={{ opacity: 0.8 }}>
              Clicar no <strong>produto</strong> = Aceitar (gera o Pix e segue por “Aceitou/Pagou”). Os botões abaixo viram saídas próprias no fluxo (ex: “Recusar” → conecte a um downsell).
            </p>
          </div>

          {/* Layout */}
          <div>
            <span className="text-[10px] text-(--text-muted) uppercase tracking-wider">Layout</span>
            <div className="mt-1 inline-flex gap-1 p-1 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
              {[
                { v: "vertical", l: "Vertical" },
                { v: "horizontal", l: "Horizontal" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => onChange({ ...data, button_layout: o.v })}
                  className={`toggle-btn ${layout === o.v ? "on" : "off"}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>

          {/* Lista de botões editáveis */}
          <div className="space-y-1.5">
            {offerButtons.map((b, i) => (
              <div key={b.id} className="flex items-center gap-1.5">
                <input
                  value={b.label}
                  onChange={(e) => renameButton(i, e.target.value)}
                  placeholder="Texto do botão"
                  className="input text-xs py-1.5! flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeButton(i)}
                  aria-label="Remover botão"
                  className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--red) hover:bg-(--red)/10 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addButton}
            className="w-full text-xs py-2 rounded-lg border border-dashed border-(--border-default) text-(--text-secondary) hover:text-foreground hover:bg-white/[0.03] transition-colors flex items-center justify-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Adicionar botão
          </button>
        </div>
      )}

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
