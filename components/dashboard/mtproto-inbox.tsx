"use client";

import { useEffect, useState } from "react";
import {
  openMtprotoInbox,
  heartbeatMtprotoInbox,
  closeMtprotoInbox,
  listInboxMessages,
} from "@/app/dashboard/automations/actions";

interface InboxMsg {
  id: string;
  tg_message_id: number;
  text: string | null;
  received_at: string;
  from_peer_name: string | null;
}

export function MtprotoInbox({ accountId }: { accountId: string }) {
  const [messages, setMessages] = useState<InboxMsg[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let pollTimer: NodeJS.Timeout | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    async function start() {
      const res = await openMtprotoInbox(accountId);
      if (!mounted) return;
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(res.error || "falha ao abrir inbox");
        return;
      }
      setStatus("live");

      // Polling de mensagens
      const poll = async () => {
        const msgs = await listInboxMessages(accountId);
        if (mounted) setMessages(msgs);
      };
      poll();
      pollTimer = setInterval(poll, 4000);

      // Heartbeat pra manter sessão viva
      heartbeatTimer = setInterval(() => {
        heartbeatMtprotoInbox(accountId).catch(() => {});
      }, 60_000);
    }

    start();

    return () => {
      mounted = false;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      closeMtprotoInbox(accountId).catch(() => {});
    };
  }, [accountId]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 text-xs">
        {status === "connecting" && <span className="text-(--text-muted)">conectando…</span>}
        {status === "live" && (
          <>
            <span className="w-2 h-2 rounded-full bg-(--cyan) animate-pulse" />
            <span className="text-(--text-secondary)">ao vivo</span>
          </>
        )}
        {status === "error" && (
          <span className="text-(--red)">erro: {errorMsg}</span>
        )}
      </div>

      <div className="space-y-2">
        {messages.length === 0 ? (
          <div className="py-8 text-center text-(--text-ghost) text-xs">
            Sem mensagens ainda. Quando o Telegram enviar um código ou alerta, aparece aqui.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className="row-hover flex flex-col gap-1 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-(--text-muted) text-sm font-medium">
                  {m.from_peer_name || "Telegram"}
                </span>
                <span className="text-(--text-ghost) text-xs">
                  {new Date(m.received_at).toLocaleString("pt-BR")}
                </span>
              </div>
              <pre className="text-foreground text-sm whitespace-pre-wrap font-sans">
                {m.text || "(sem texto)"}
              </pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
