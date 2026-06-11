"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getLeadMessages } from "@/lib/actions/client-actions";
import type { LeadMessage } from "@/lib/types/database";

/**
 * Carrega a timeline de um lead e fica ao vivo enquanto o painel estiver
 * aberto. LAZY por design: só conecta quando `leadId` existe (lead aberto)
 * e desconecta no cleanup (fechou o painel / trocou de lead). Nada disso
 * roda no resto do app.
 *
 * Fluxo:
 *  1. busca o histórico (server action, RLS) ao abrir o lead;
 *  2. assina postgres_changes (INSERT) em lead_messages filtrado por lead_id;
 *  3. cada nova linha (in/out/event) entra na lista em tempo real.
 */
export function useLeadMessagesRealtime(leadId: string | null) {
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!leadId) {
      // rAF evita setState síncrono no corpo do effect (cascading renders).
      const raf = requestAnimationFrame(() => setMessages([]));
      seen.current = new Set();
      return () => cancelAnimationFrame(raf);
    }

    let cancelled = false;
    const raf = requestAnimationFrame(() => setLoading(true));
    seen.current = new Set();

    getLeadMessages(leadId)
      .then((rows) => {
        if (cancelled) return;
        for (const r of rows) seen.current.add(r.id);
        setMessages(rows);
      })
      .catch((err) => {
        console.error("[chat] load history failed:", err);
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const supabase = createClient();
    const channel = supabase
      .channel(`lead_messages:${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lead_messages",
          filter: `lead_id=eq.${leadId}`,
        },
        (payload) => {
          const row = payload.new as LeadMessage;
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);
          setMessages((prev) => [...prev, row]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      supabase.removeChannel(channel);
    };
  }, [leadId]);

  /** Otimista: injeta uma mensagem 'out' antes do realtime confirmar. */
  function appendOptimistic(msg: LeadMessage) {
    if (seen.current.has(msg.id)) return;
    seen.current.add(msg.id);
    setMessages((prev) => [...prev, msg]);
  }

  return { messages, loading, appendOptimistic };
}
