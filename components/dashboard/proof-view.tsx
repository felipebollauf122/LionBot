"use client";

import { useState } from "react";

interface Product {
  id: string;
  name: string;
  ghost_name: string | null;
  ghost_description: string | null;
  description: string | null;
}

interface Lead {
  id: string;
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  tid: string | null;
  fbclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface Bot {
  bot_username: string;
}

interface Transaction {
  id: string;
  external_id: string;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  paid_at: string | null;
  created_at: string;
  lead_id: string;
  bot_id: string;
  product_id: string;
  flow_id: string | null;
  products: Product | null;
  leads: Lead;
  bots: Bot | null;
}

interface OtherTx {
  id: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
  products: { name: string; ghost_name: string | null } | null;
}

interface TrackingEvent {
  event_data: Record<string, unknown> | null;
  created_at: string;
  event_type: string;
}

const statusLabel: Record<string, { text: string; bg: string; fg: string }> = {
  approved: { text: "PAGO", bg: "#10b981", fg: "#ffffff" },
  pending: { text: "PENDENTE", bg: "#f59e0b", fg: "#ffffff" },
  refused: { text: "RECUSADO", bg: "#ef4444", fg: "#ffffff" },
  refunded: { text: "REEMBOLSADO", bg: "#7f1d1d", fg: "#ffffff" },
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
}

function fmtCurrency(amount: number, currency: string): string {
  return (amount / 100).toLocaleString("pt-BR", { style: "currency", currency });
}

function gatewayLabel(g: string): string {
  if (g === "evpay") return "Yvepay";
  if (g === "sigilopay") return "Poseidon Pay";
  return g;
}

// Renderiza só se há valor — evita campo vazio "—" poluindo o documento
function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  const v = value === null || value === undefined || value === "" || value === "—" ? null : String(value);
  if (!v) return null;
  return (
    <div className="mb-3 break-inside-avoid">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className="text-sm text-zinc-900 mt-0.5">{v}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 print:mb-4 break-inside-avoid">
      <h2 className="text-xs uppercase tracking-[0.15em] text-zinc-400 font-bold mb-2 pb-1.5 border-b border-zinc-200">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ProofView({
  transaction,
  trackingEvent,
  otherTransactions,
}: {
  transaction: Transaction;
  trackingEvent: TrackingEvent | null;
  otherTransactions: OtherTx[];
}) {
  const [showRaw, setShowRaw] = useState(false);
  const product = transaction.products;
  const lead = transaction.leads;
  const productDisplay = product?.ghost_name || product?.name || "—";
  const productDescription = product?.ghost_description || product?.description || null;
  const status = statusLabel[transaction.status] ?? {
    text: transaction.status.toUpperCase(),
    bg: "#71717a",
    fg: "#ffffff",
  };

  const buyerEmail = String(lead.state?.email ?? "");
  const buyerPhone = String(lead.state?.phone ?? "");
  const buyerDocument = String(lead.state?.document ?? "");

  const timeline: Array<{ time: string; label: string; detail?: string }> = [];
  timeline.push({
    time: lead.created_at,
    label: "Lead criado (primeiro /start no bot)",
    detail: `Telegram ID ${lead.telegram_user_id}${lead.username ? ` · @${lead.username}` : ""}`,
  });
  if (trackingEvent) {
    timeline.push({
      time: trackingEvent.created_at,
      label: "Página de tracking visitada",
      detail: trackingEvent.event_type,
    });
  }
  timeline.push({
    time: transaction.created_at,
    label: "PIX gerado",
    detail: `${gatewayLabel(transaction.gateway)} · ${fmtCurrency(transaction.amount, transaction.currency)}`,
  });
  if (transaction.paid_at) {
    timeline.push({
      time: transaction.paid_at,
      label: "Pagamento confirmado pela gateway",
    });
  }
  timeline.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const evData = trackingEvent?.event_data ?? null;
  const ipFromTracking = evData ? String((evData as Record<string, unknown>).ip ?? "") : "";
  const uaFromTracking = evData
    ? String(
        (evData as Record<string, unknown>).user_agent ?? (evData as Record<string, unknown>).ua ?? "",
      )
    : "";

  const generatedAt = fmtDateTime(new Date().toISOString());

  return (
    <>
      {/* CSS print: oculta tudo que não é o documento, força preto-no-branco */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 16mm 14mm;
          }
          html, body {
            background: white !important;
            color: #18181b !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Barra superior — só na tela */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
        <a
          href={`/dashboard/bots/${transaction.bot_id}/transactions`}
          className="text-zinc-500 hover:text-zinc-900 text-sm"
        >
          ← Voltar para vendas
        </a>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 rounded-md bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition-colors"
        >
          Baixar PDF
        </button>
      </div>

      {/* Documento */}
      <article className="max-w-[800px] mx-auto px-10 py-12 print:px-0 print:py-0 print:max-w-none">
        {/* Cabeçalho com logo */}
        <header className="flex items-end justify-between pb-6 border-b border-zinc-300 mb-8">
          <div>
            <div className="text-zinc-400 text-[10px] uppercase tracking-[0.2em] font-semibold mb-1">
              LionBot
            </div>
            <h1 className="text-2xl font-bold text-zinc-900 leading-tight">
              Comprovação de Compra
            </h1>
            <p className="text-zinc-500 text-xs mt-1">
              Documento de evidência para contestação / chargeback
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Emitido em
            </div>
            <div className="text-sm text-zinc-900 mt-0.5">{generatedAt}</div>
          </div>
        </header>

        {/* Status + Valor em destaque */}
        <div className="grid grid-cols-2 gap-4 mb-8 break-inside-avoid">
          <div className="border border-zinc-300 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
              Status do pagamento
            </div>
            <div
              className="inline-block px-3 py-1 rounded text-sm font-bold tracking-wide"
              style={{ background: status.bg, color: status.fg }}
            >
              {status.text}
            </div>
          </div>
          <div className="border border-zinc-300 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
              Valor da transação
            </div>
            <div className="text-2xl font-bold text-zinc-900 leading-none">
              {fmtCurrency(transaction.amount, transaction.currency)}
            </div>
          </div>
        </div>

        {/* Produto */}
        <Section title="Produto adquirido">
          <div className="text-lg font-semibold text-zinc-900">{productDisplay}</div>
          {productDescription && (
            <div className="text-sm text-zinc-600 mt-1">{productDescription}</div>
          )}
        </Section>

        {/* Comprador */}
        <Section title="Comprador">
          <div className="grid grid-cols-2 gap-x-6">
            <Field label="Nome" value={`${lead.first_name} ${lead.last_name ?? ""}`.trim()} />
            <Field label="Username Telegram" value={lead.username ? `@${lead.username}` : null} />
            <Field label="Telegram ID" value={lead.telegram_user_id} />
            <Field label="Email" value={buyerEmail} />
            <Field label="Telefone" value={buyerPhone} />
            <Field label="Documento (CPF)" value={buyerDocument} />
            <Field label="Bot que recebeu" value={transaction.bots?.bot_username ? `@${transaction.bots.bot_username}` : null} />
          </div>
        </Section>

        {/* Pagamento */}
        <Section title="Detalhes do pagamento">
          <div className="grid grid-cols-2 gap-x-6">
            <Field label="Processadora" value={gatewayLabel(transaction.gateway)} />
            <Field label="Método" value="PIX" />
            <Field label="PIX gerado em" value={fmtDateTime(transaction.created_at)} />
            <Field label="Pagamento confirmado em" value={fmtDateTime(transaction.paid_at)} />
            <Field label="ID da transação (gateway)" value={transaction.external_id} />
          </div>
        </Section>

        {/* Timeline */}
        <Section title="Linha do tempo">
          <ol className="space-y-2.5">
            {timeline.map((ev, i) => (
              <li key={i} className="flex gap-4 text-sm break-inside-avoid">
                <span className="text-zinc-500 text-xs whitespace-nowrap pt-0.5 tabular-nums w-[150px] shrink-0">
                  {new Date(ev.time).toLocaleString("pt-BR")}
                </span>
                <div className="border-l-2 border-zinc-300 pl-4 -ml-px">
                  <div className="text-zinc-900 font-medium">{ev.label}</div>
                  {ev.detail && <div className="text-zinc-500 text-xs">{ev.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {/* Origem (só se houver algum dado) */}
        {(lead.utm_source ||
          lead.utm_medium ||
          lead.utm_campaign ||
          lead.utm_content ||
          lead.utm_term ||
          lead.tid ||
          lead.fbclid ||
          ipFromTracking ||
          uaFromTracking) && (
          <Section title="Origem do tráfego">
            <div className="grid grid-cols-2 gap-x-6">
              <Field label="utm_source" value={lead.utm_source} />
              <Field label="utm_medium" value={lead.utm_medium} />
              <Field label="utm_campaign" value={lead.utm_campaign} />
              <Field label="utm_content" value={lead.utm_content} />
              <Field label="utm_term" value={lead.utm_term} />
              <Field label="Tracking ID (tid)" value={lead.tid} />
              <Field label="Facebook Click ID" value={lead.fbclid} />
              <Field label="IP do clique inicial" value={ipFromTracking} />
            </div>
            {uaFromTracking && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Navegador / User Agent
                </div>
                <div className="text-xs text-zinc-700 mt-0.5 font-mono break-all">
                  {uaFromTracking}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Outras transações */}
        {otherTransactions.length > 0 && (
          <Section title={`Outras transações deste comprador (${otherTransactions.length})`}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 text-[10px] uppercase tracking-wider border-b border-zinc-200">
                  <th className="text-left py-2 font-semibold">Data</th>
                  <th className="text-left py-2 font-semibold">Produto</th>
                  <th className="text-right py-2 font-semibold">Valor</th>
                  <th className="text-right py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {otherTransactions.map((o) => {
                  const ost = statusLabel[o.status] ?? { text: o.status, bg: "#71717a", fg: "#fff" };
                  return (
                    <tr key={o.id} className="border-b border-zinc-100">
                      <td className="py-2 text-zinc-700 tabular-nums">
                        {new Date(o.created_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-2 text-zinc-900">
                        {o.products?.ghost_name || o.products?.name || "—"}
                      </td>
                      <td className="py-2 text-right text-zinc-700 tabular-nums">
                        {fmtCurrency(o.amount, o.currency)}
                      </td>
                      <td className="py-2 text-right">
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[10px] font-bold"
                          style={{ background: ost.bg, color: ost.fg }}
                        >
                          {ost.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        )}

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-zinc-200 text-center text-[10px] text-zinc-400">
          Documento emitido eletronicamente por LionBot · {generatedAt}
          <br />
          Verificação interna: {transaction.id}
        </footer>

        {/* Bloco JSON técnico — só tela, nunca PDF */}
        <div className="no-print mt-8 border border-zinc-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-bold">
              Dados técnicos (JSON)
            </h3>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-zinc-600 hover:text-zinc-900 text-xs underline"
            >
              {showRaw ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {showRaw && (
            <pre className="mt-3 p-3 rounded bg-zinc-50 border border-zinc-200 text-[10px] text-zinc-700 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(
                {
                  transaction: {
                    id: transaction.id,
                    external_id: transaction.external_id,
                    amount: transaction.amount,
                    currency: transaction.currency,
                    status: transaction.status,
                    gateway: gatewayLabel(transaction.gateway),
                    created_at: transaction.created_at,
                    paid_at: transaction.paid_at,
                  },
                  product: {
                    id: product?.id,
                    name_on_invoice: productDisplay,
                    description_on_invoice: productDescription,
                  },
                  lead: {
                    id: lead.id,
                    telegram_user_id: lead.telegram_user_id,
                    username: lead.username,
                    first_name: lead.first_name,
                    last_name: lead.last_name,
                    email: lead.state?.email,
                    phone: lead.state?.phone,
                    document: lead.state?.document,
                    created_at: lead.created_at,
                  },
                  tracking: trackingEvent
                    ? {
                        first_seen: trackingEvent.created_at,
                        event_type: trackingEvent.event_type,
                        event_data: trackingEvent.event_data,
                      }
                    : null,
                },
                null,
                2,
              )}
            </pre>
          )}
        </div>
      </article>
    </>
  );
}
