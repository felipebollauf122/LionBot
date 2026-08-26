"use client";

import type { BundleOption } from "../flow-editor";
import { GatewaySelect } from "./gateway-select";

interface PaymentButtonConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  bundles: BundleOption[];
  canRandomize?: boolean;
  enabledGateways?: string[];
}

// Id nunca-reutilizável (timestamp + aleatório em base36) — nunca "recicla" o
// id de um botão deletado, senão uma edge órfã antiga reatacaria no botão novo.
function freshId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function PaymentButtonConfig({ data, onChange, bundles, canRandomize = false, enabledGateways = [] }: PaymentButtonConfigProps) {
  const bundleId = String(data.bundle_id ?? "");
  const timeoutMinutes = Number(data.payment_timeout_minutes ?? 15);
  const saleType = String(data.sale_type ?? "main");
  const randomizePrice = Boolean(data.randomize_price);
  const bundleIds: string[] = Array.isArray(data.bundle_ids) ? (data.bundle_ids as string[]) : [];
  const toggleBundle = (id: string) => {
    const next = bundleIds.includes(id) ? bundleIds.filter((b) => b !== id) : [...bundleIds, id];
    onChange({ ...data, bundle_ids: next });
  };

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
    // id nunca-reutilizável (timestamp + aleatório) — reaproveitar o menor
    // btn_N livre fazia a edge órfã de um botão deletado reatacar em silêncio
    // no próximo botão criado. O default semântico "reject" segue intocado.
    setButtons([...offerButtons, { id: freshId("btn"), label: "Novo botão" }]);
  };
  const removeButton = (i: number) => {
    const next = offerButtons.filter((_, idx) => idx !== i);
    setButtons(next.length > 0 ? next : [{ id: "reject", label: "Recusar" }]);
  };

  // ── Botões extras (qualquer tipo de venda) — cada um vira um botão do
  // Telegram embaixo dos preços. "Link" abre uma URL direto (canal, grupo,
  // qualquer link) sem passar pelo fluxo. "Fluxo" vira um handle próprio no
  // cardzinho, do lado de Pagou/Não Pagou, pra você conectar a outro nó. ──
  type CustomBtn = { id: string; label: string; kind: "link" | "flow"; url?: string };
  const customButtons: CustomBtn[] = Array.isArray(data.custom_buttons)
    ? (data.custom_buttons as CustomBtn[])
    : [];
  const setCustomButtons = (next: CustomBtn[]) => onChange({ ...data, custom_buttons: next });
  const updateCustomButton = (i: number, patch: Partial<CustomBtn>) => {
    setCustomButtons(customButtons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };
  const addCustomButton = () => {
    // prefixo próprio (custom_*) pra nunca colidir com os ids de
    // accept_reject_buttons (reject/btn_*) — os dois podem coexistir no
    // mesmo nó (ex: upsell com "Recusar" E um botão extra de suporte).
    // Sufixo nunca-reutilizável: ver comentário em addButton.
    setCustomButtons([...customButtons, { id: freshId("custom"), label: "Novo botão", kind: "link", url: "" }]);
  };
  const removeCustomButton = (i: number) => {
    setCustomButtons(customButtons.filter((_, idx) => idx !== i));
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
          <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={current.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
                <span className="block text-[0.625rem] leading-tight mt-0.5 text-(--text-secondary)">{s.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[0.6875rem] leading-snug mt-2 text-(--text-secondary)">
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
            <p className="text-[0.6875rem] leading-snug text-(--text-secondary) mt-0.5 mb-2">
              Clicar no <strong>produto</strong> = Aceitar (gera o Pix e segue por “Aceitou/Pagou”). Os botões abaixo viram saídas próprias no fluxo (ex: “Recusar” → conecte a um downsell).
            </p>
          </div>

          {/* Layout */}
          <div>
            <span className="text-[10px] text-(--text-secondary) uppercase tracking-wider">Layout</span>
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
                  aria-label={`Remover botão ${b.label}`}
                  className="w-11 h-11 md:w-7 md:h-7 shrink-0 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--red) hover:bg-(--red)/10 transition-colors"
                >
                  <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addButton}
            className="w-full text-xs py-2 rounded-lg border border-dashed border-(--border-default) text-(--text-secondary) hover:text-foreground hover:bg-white/[0.03] transition-colors flex items-center justify-center gap-1.5"
          >
            <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Adicionar botão
          </button>
        </div>
      )}

      <div>
        {/* Randomizar preço/oferta — toggle de acesso Premium */}
        <div className="flex items-center justify-between mb-1">
          <label className="input-label mb-0!">Randomizar preço/oferta</label>
          <button
            type="button"
            disabled={!canRandomize}
            onClick={() => onChange({ ...data, randomize_price: !randomizePrice })}
            className={`toggle-btn ${randomizePrice ? "on" : "off"} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {randomizePrice ? "Ativado" : "Desativado"}
          </button>
        </div>
        {!canRandomize && (
          <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mb-2">
            Recurso Premium — disponível pra donos ou assinantes Premium.
          </p>
        )}
        {canRandomize && (
          <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mb-2">
            Sorteia um conjunto entre os selecionados a cada envio.
          </p>
        )}

        {randomizePrice && canRandomize ? (
          <>
            <label className="input-label">Conjuntos de Produtos</label>
            {bundles.length === 0 ? (
              <p className="text-(--amber) text-[0.6875rem] leading-snug mt-1.5">
                Nenhum conjunto encontrado. Crie um na aba &quot;Conjuntos&quot;.
              </p>
            ) : (
              <div className="space-y-1.5">
                {bundles.map((bundle) => {
                  const checked = bundleIds.includes(bundle.id);
                  return (
                    <button
                      key={bundle.id}
                      type="button"
                      onClick={() => toggleBundle(bundle.id)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-all"
                      style={{
                        background: checked ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "rgba(255,255,255,0.02)",
                        borderColor: checked ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border-subtle)",
                      }}
                    >
                      <span
                        className="w-4 h-4 shrink-0 rounded border flex items-center justify-center"
                        style={{
                          borderColor: checked ? "var(--accent)" : "var(--border-default)",
                          background: checked ? "var(--accent)" : "transparent",
                        }}
                      >
                        {checked && (
                          <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      <span className="text-xs text-(--text-secondary)">{bundle.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
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
              <p className="text-(--amber) text-[0.6875rem] leading-snug mt-1.5">
                Nenhum conjunto encontrado. Crie um na aba &quot;Conjuntos&quot;.
              </p>
            )}
          </>
        )}
      </div>

      {/* Botões extras — aparecem embaixo dos preços, pra qualquer tipo de venda */}
      <div
        className="rounded-xl p-3 space-y-2.5"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}
      >
        <div>
          <label className="input-label mb-0!">Botões extras</label>
          <p className="text-[0.6875rem] leading-snug text-(--text-secondary) mt-0.5 mb-2">
            Aparecem embaixo dos preços. <strong>Link</strong> abre uma URL direto (canal, grupo, qualquer
            link). <strong>Fluxo</strong> vira um handle no cardzinho, do lado de Pagou/Não Pagou — conecte a
            outro nó pra continuar o fluxo por ali.
          </p>
        </div>

        <div className="space-y-2">
          {customButtons.map((b, i) => (
            <div key={b.id} className="rounded-lg p-2 space-y-1.5 bg-white/[0.02] border border-(--border-subtle)">
              <div className="flex items-center gap-1.5">
                <input
                  value={b.label}
                  onChange={(e) => updateCustomButton(i, { label: e.target.value })}
                  placeholder="Texto do botão"
                  className="input text-xs py-1.5! flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeCustomButton(i)}
                  aria-label={`Remover botão ${b.label}`}
                  className="w-11 h-11 md:w-7 md:h-7 shrink-0 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--red) hover:bg-(--red)/10 transition-colors"
                >
                  <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div className="inline-flex gap-1 p-1 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
                <button
                  type="button"
                  onClick={() => updateCustomButton(i, { kind: "link" })}
                  className={`toggle-btn ${b.kind === "link" ? "on" : "off"}`}
                >
                  Link
                </button>
                <button
                  type="button"
                  onClick={() => updateCustomButton(i, { kind: "flow" })}
                  className={`toggle-btn ${b.kind === "flow" ? "on" : "off"}`}
                >
                  Fluxo
                </button>
              </div>
              {b.kind === "link" ? (
                <input
                  value={b.url ?? ""}
                  onChange={(e) => updateCustomButton(i, { url: e.target.value })}
                  placeholder="https://t.me/seucanal"
                  className="input text-xs py-1.5!"
                />
              ) : (
                <p className="text-(--purple) text-[0.6875rem] leading-snug">
                  Conecte esse botão a um nó no editor — o handle aparece no cardzinho deste nó.
                </p>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addCustomButton}
          className="w-full text-xs py-2 rounded-lg border border-dashed border-(--border-default) text-(--text-secondary) hover:text-foreground hover:bg-white/[0.03] transition-colors flex items-center justify-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Adicionar botão
        </button>
      </div>

      {/* Gateway — permite ter um nó cobrando PIX e outro cobrando cripto no
          mesmo fluxo, cada um ligado a um botão diferente. */}
      <div>
        <GatewaySelect
          value={String(data.gateway ?? "")}
          onChange={(gateway) => onChange({ ...data, gateway: gateway || undefined })}
          enabledGateways={enabledGateways}
        />
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-1">
          Por qual gateway este nó cobra. Deixe em <strong>Padrão do bot</strong> pra
          usar o das Configurações.
        </p>
      </div>

      <div>
        <label className="input-label">Timeout &quot;Nao Pagou&quot; (minutos)</label>
        <input
          type="number"
          min={0}
          max={1440}
          value={timeoutMinutes}
          onChange={(e) => {
            // 0 é válido e DESATIVA o timeout (a engine só agenda quando > 0)
            // — nada de `|| 15`, que convertia 0 em 15 em silêncio. Campo
            // vazio volta pro padrão 15.
            const raw = e.target.value;
            const next = raw === "" ? 15 : Math.min(1440, Math.max(0, parseInt(raw, 10) || 0));
            onChange({ ...data, payment_timeout_minutes: next });
          }}
          className="input"
        />
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-1">
          Tempo ate disparar o fluxo &quot;Nao Pagou&quot;. Use 0 para desativar.
        </p>
      </div>
      <div
        className="rounded-xl p-3 text-[11px]"
        style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--amber) 6%, transparent), color-mix(in srgb, var(--amber) 2%, transparent))",
          border: "1px solid color-mix(in srgb, var(--amber) 10%, transparent)",
          color: "var(--amber)",
        }}
      >
        <strong>Pagou:</strong> Dispara imediatamente quando o pagamento e confirmado.
        <br />
        <strong>Nao Pagou:</strong> Dispara apos o timeout se o pagamento nao for confirmado. Conecte um delay ou mensagem de lembrete.
      </div>
    </div>
  );
}
