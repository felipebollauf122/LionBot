"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";
import {
  saveChannel,
  saveMessage,
  deleteMessage,
  duplicateMessage,
  setPinnedMessage,
  reorderMessages,
} from "@/lib/actions/social-proof-actions";
import { ComposerShell } from "@/components/dashboard/composer/composer-shell";
import { ChannelCard } from "@/components/dashboard/social-proof/channel-card";
import { OwnerCard } from "@/components/dashboard/social-proof/owner-card";
import { SocialProofExtras } from "@/components/dashboard/social-proof/social-proof-extras";

/**
 * Adaptador da Prova Social sobre o ComposerShell: o estado do canal, os cards
 * de identidade, os campos extras do editor e as Server Actions dela. O shell
 * não conhece nada disso — a campanha agendada monta as suas próprias peças.
 */
export function SocialProofComposer({
  botId,
  channel,
  messages,
}: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
  const [salvandoCanal, start] = useTransition();
  const [erroCanal, setErroCanal] = useState<string | null>(null);

  const [canal, setCanal] = useState<ChannelInput>({
    title: channel?.title ?? "",
    avatar_url: channel?.avatar_url ?? null,
    subscribers_label: channel?.subscribers_label ?? "",
    is_verified: channel?.is_verified ?? false,
    is_active: channel?.is_active ?? false,
    owner_name: channel?.owner_name ?? "",
    owner_avatar_url: channel?.owner_avatar_url ?? null,
    owner_username: channel?.owner_username ?? "",
    unread_badge: channel?.unread_badge ?? 0,
  });

  const pinnedId = channel?.pinned_message_id ?? null;
  const pinnedText = messages.find((m) => m.id === pinnedId)?.content_text ?? "";

  function salvarCanal() {
    setErroCanal(null);
    start(async () => {
      const r = await saveChannel(botId, canal);
      if (!r.ok) setErroCanal(r.error);
    });
  }

  return (
    <ComposerShell
      title="Prova Social"
      subtitle="Monte a prévia do canal que aparecerá no seu Mini App."
      channel={canal}
      messages={messages}
      pinnedId={pinnedId}
      pinnedText={pinnedText}
      // O salvamento do canal roda no transition DESTE componente, não no do
      // shell. Sem devolver o pending, a prévia, a composição rápida e o
      // editor seguem clicáveis durante a gravação — e na configuração
      // inicial dá pra mandar mensagem antes de a linha do canal existir,
      // recebendo "Salve os dados do canal antes de criar mensagens.". A UI
      // de antes do refactor (um `useTransition` só) tornava isso impossível.
      busy={salvandoCanal}
      leftColumn={
        <>
          <ChannelCard value={canal} onChange={setCanal} />
          <OwnerCard value={canal} onChange={setCanal} />
        </>
      }
      editorExtras={(value: MessageInput, onChange: (v: MessageInput) => void) => (
        <SocialProofExtras value={value} onChange={onChange} />
      )}
      notice={
        <AnimatePresence>
          {erroCanal && (
            <motion.p
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red) overflow-hidden"
            >
              {erroCanal}
            </motion.p>
          )}
        </AnimatePresence>
      }
      headerActions={
        <>
          <motion.a
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            href={`/mini/${botId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-(--border-default) px-3 py-2 text-sm text-(--text-secondary) transition-colors hover:text-(--text-primary) hover:bg-(--bg-hover)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
            <span className="hidden md:inline">Visualizar</span>
          </motion.a>
          <motion.button
            whileHover={{ scale: salvandoCanal ? 1 : 1.02 }}
            whileTap={{ scale: salvandoCanal ? 1 : 0.98 }}
            type="button"
            onClick={salvarCanal}
            disabled={salvandoCanal}
            className="relative flex items-center justify-center overflow-hidden rounded-lg bg-(--accent) px-4 py-2 text-sm font-semibold text-(--on-accent) disabled:opacity-80 transition-opacity"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {salvandoCanal ? (
                <motion.div
                  key="saving"
                  initial={{ opacity: 0, y: -15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 15 }}
                  className="flex items-center gap-2"
                >
                  <svg className="h-4 w-4 animate-spin text-(--on-accent)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <span className="hidden md:inline">Salvando…</span>
                </motion.div>
              ) : (
                <motion.div
                  key="save"
                  initial={{ opacity: 0, y: -15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 15 }}
                >
                  Salvar
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </>
      }
      actions={{
        saveMessage: (input: MessageInput) => saveMessage(botId, input),
        deleteMessage: (id) => deleteMessage(id, botId),
        duplicateMessage: (id) => duplicateMessage(id, botId),
        reorderMessages: (ids) => reorderMessages(botId, ids),
        setPinned: (id) => setPinnedMessage(botId, id),
      }}
    />
  );
}
