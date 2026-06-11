"use client";

import { useEffect, useRef, useState } from "react";
import type { Lead, LeadMessage, LeadMessageEventType } from "@/lib/types/database";
import { useLeadMessagesRealtime } from "@/lib/hooks/use-lead-messages-realtime";
import { sendMessageToLead, type ClientStatus } from "@/lib/actions/client-actions";

interface ChatPanelProps {
  botId: string;
  lead: Lead;
  status: ClientStatus;
  onBack: () => void;
}

const STATUS_BADGE: Record<ClientStatus, { label: string; color: string } | null> = {
  paid: { label: "Pagou", color: "var(--green, #22e0a1)" },
  pending: { label: "Pendente", color: "var(--amber)" },
  new: { label: "Novo", color: "var(--cyan)" },
  blocked: null, // já mostramos o selo "Bloqueou" separadamente
};

const EVENT_META: Record<LeadMessageEventType, { icon: string; color: string }> = {
  button_click: { icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11", color: "var(--accent)" },
  pix_generated: { icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", color: "var(--amber)" },
  payment_approved: { icon: "M20 6L9 17l-5-5", color: "var(--green, #22e0a1)" },
  blocked: { icon: "M4.93 4.93l14.14 14.14M12 22a10 10 0 100-20 10 10 0 000 20z", color: "var(--red)" },
};

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today); y.setDate(y.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function ChatPanel({ botId, lead, status, onBack }: ChatPanelProps) {
  const { messages, loading, appendOptimistic } = useLeadMessagesRealtime(lead.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [blocked, setBlocked] = useState(lead.blocked);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const optimisticSeq = useRef(0);

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Sem nome";

  // Auto-scroll para o fim quando chega mensagem.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  async function send() {
    const text = draft.trim();
    if (!text || sending || blocked) return;
    setSending(true);
    setError(null);

    // Otimista: mostra na hora com id temporário.
    const tempId = `optimistic-${optimisticSeq.current++}`;
    appendOptimistic({
      id: tempId,
      lead_id: lead.id,
      bot_id: botId,
      tenant_id: lead.tenant_id,
      direction: "out",
      text,
      event_type: null,
      event_data: {},
      sent_by: "operator",
      tg_message_id: null,
      created_at: new Date().toISOString(),
    } as LeadMessage);
    setDraft("");

    const res = await sendMessageToLead(botId, lead.id, text);
    setSending(false);
    if (!res.ok) {
      if (res.error === "blocked") setBlocked(true);
      setError(res.message ?? "Falha ao enviar.");
    }
  }

  // Agrupa por dia para inserir separadores.
  let lastDay = "";

  return (
    <div className="flex flex-col h-full min-h-0 bg-(--bg-root)">
      {/* Header do chat */}
      <div className="shrink-0 h-16 px-4 flex items-center gap-3 border-b border-(--border-subtle) glass">
        <button onClick={onBack} className="lg:hidden w-9 h-9 -ml-1 rounded-lg grid place-items-center hover:bg-white/5 transition-colors" aria-label="Voltar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <span className="w-10 h-10 rounded-xl grid place-items-center text-xs font-bold shrink-0 bg-(--accent)/[0.12] text-(--accent)">
          {(name[0] ?? "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground truncate">{name}</h2>
            {blocked ? (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0" style={{ background: "color-mix(in srgb, var(--red) 14%, transparent)", color: "var(--red)" }}>
                Bloqueou
              </span>
            ) : (
              STATUS_BADGE[status] && (
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0"
                  style={{ background: `color-mix(in srgb, ${STATUS_BADGE[status]!.color} 14%, transparent)`, color: STATUS_BADGE[status]!.color }}
                >
                  {STATUS_BADGE[status]!.label}
                </span>
              )
            )}
          </div>
          <p className="text-[11px] text-(--text-muted) truncate">
            {lead.username ? `@${lead.username}` : `ID ${lead.telegram_user_id}`}
            {lead.utm_source ? ` · ${lead.utm_source}` : ""}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-1">
        {loading ? (
          <ChatSkeleton />
        ) : messages.length === 0 ? (
          <div className="h-full grid place-items-center text-center">
            <p className="text-[13px] text-(--text-muted) max-w-xs">
              Sem mensagens guardadas ainda. O que o lead mandar e o que você responder a partir de agora aparece aqui (últimos 30 dias).
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="flex items-center justify-center my-3">
                    <span className="text-[10px] uppercase tracking-wider text-(--text-ghost) bg-white/[0.03] px-2.5 py-1 rounded-full">{day}</span>
                  </div>
                )}
                <MessageRow msg={m} />
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-(--border-subtle) p-3 glass">
        {error && <p className="text-[11px] text-(--red) mb-2 px-1">{error}</p>}
        {blocked ? (
          <div className="text-center text-[12px] text-(--text-muted) py-2">
            Esse lead bloqueou o bot — não dá pra enviar mensagens.
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Responder pelo bot..."
              className="input flex-1 resize-none max-h-32 py-2.5! text-sm leading-relaxed"
              style={{ minHeight: "2.75rem" }}
            />
            <button
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="btn-primary shrink-0 h-11 w-11 p-0! grid place-items-center"
              aria-label="Enviar"
            >
              {sending ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageRow({ msg }: { msg: LeadMessage }) {
  if (msg.direction === "event") {
    const meta = msg.event_type ? EVENT_META[msg.event_type] : null;
    return (
      <div className="flex items-center justify-center my-2">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border"
          style={{
            color: meta?.color ?? "var(--text-muted)",
            borderColor: `color-mix(in srgb, ${meta?.color ?? "var(--text-muted)"} 30%, transparent)`,
            background: `color-mix(in srgb, ${meta?.color ?? "var(--text-muted)"} 8%, transparent)`,
          }}
        >
          {meta && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={meta.icon} />
            </svg>
          )}
          {msg.text}
          <span className="text-(--text-ghost) ml-1 tabular-nums">{timeOf(msg.created_at)}</span>
        </span>
      </div>
    );
  }

  const isOut = msg.direction === "out";
  return (
    <div className={`flex ${isOut ? "justify-end" : "justify-start"} mb-1.5`}>
      <div
        className={`max-w-[78%] px-3.5 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
          isOut
            ? "rounded-br-md text-white"
            : "rounded-bl-md text-foreground bg-white/[0.05]"
        }`}
        style={isOut ? { background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, var(--purple)))" } : undefined}
      >
        {msg.text}
        <span className={`block text-right text-[9px] mt-0.5 tabular-nums ${isOut ? "text-white/70" : "text-(--text-ghost)"}`}>
          {timeOf(msg.created_at)}
        </span>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="space-y-3 py-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
          <div className={`h-9 rounded-2xl bg-white/[0.04] animate-pulse ${i % 2 ? "w-40" : "w-52"}`} />
        </div>
      ))}
    </div>
  );
}
