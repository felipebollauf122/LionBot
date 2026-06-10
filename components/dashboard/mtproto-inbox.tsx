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
        {status === "connecting" && <span className="text-white/40">conectando…</span>}
        {status === "live" && (
          <>
            <span className="w-2 h-2 rounded-full bg-(--cyan) animate-pulse" />
            <span className="text-white/60">ao vivo</span>
          </>
        )}
        {status === "error" && (
          <span className="text-red-400">erro: {errorMsg}</span>
        )}
      </div>

      <div className="space-y-2">
        {messages.length === 0 ? (
          <p className="text-white/40 text-sm">
            Sem mensagens ainda. Quando o Telegram enviar um código ou alerta, aparece aqui.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className="p-3 rounded border border-white/10 bg-white/[0.02]"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-white/80 text-sm font-medium">
                  {m.from_peer_name || "Telegram"}
                </span>
                <span className="text-white/30 text-xs">
                  {new Date(m.received_at).toLocaleString("pt-BR")}
                </span>
              </div>
              <pre className="text-white/90 text-sm whitespace-pre-wrap font-sans">
                {m.text || "(sem texto)"}
              </pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
