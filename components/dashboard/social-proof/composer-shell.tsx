"use client";

import { useState, useTransition } from "react";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import { motion, AnimatePresence } from "motion/react";
import type { ChannelInput, MessageInput, SenderKind } from "@/lib/social-proof/types";
import { normalizeReactions } from "@/lib/social-proof/reactions";
import {
  saveChannel,
  saveMessage,
  deleteMessage,
  duplicateMessage,
  setPinnedMessage,
  reorderMessages,
} from "@/lib/actions/social-proof-actions";
import { ChannelCard } from "@/components/dashboard/social-proof/channel-card";
import { OwnerCard } from "@/components/dashboard/social-proof/owner-card";
import { MessageEditor } from "@/components/dashboard/social-proof/message-editor";
import { QuickCompose } from "@/components/dashboard/social-proof/quick-compose";
import { FeedPreview } from "@/components/dashboard/social-proof/feed-preview";

function mensagemVazia(kind: SenderKind = "member"): MessageInput {
  return {
    sender_kind: kind,
    sender_name: "",
    sender_avatar_url: null,
    kind: "text",
    content_text: "",
    media: [],
    reactions: [],
    reply_to_id: null,
    display_time: null,
    offset_seconds: 600,
    views_count: 0,
  };
}

function paraInput(m: SocialProofMessage): MessageInput {
  return {
    id: m.id,
    sender_kind: m.sender_kind === "owner" ? "owner" : "member",
    sender_name: m.sender_name,
    sender_avatar_url: m.sender_avatar_url,
    kind: m.kind as MessageInput["kind"],
    content_text: m.content_text,
    media: Array.isArray(m.media) ? m.media : [],
    reactions: normalizeReactions(m.reactions),
    reply_to_id: m.reply_to_id,
    display_time: m.display_time,
    offset_seconds: m.offset_seconds,
    views_count: m.views_count,
  };
}

export function ComposerShell({
  botId,
  channel,
  messages,
}: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
  const [pending, start] = useTransition();
  const [erroCanal, setErroCanal] = useState<string | null>(null);
  const [erroMensagem, setErroMensagem] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<MessageInput | null>(null);
  const [senderRapido, setSenderRapido] = useState<SenderKind>("owner");
  const [mobileTab, setMobileTab] = useState<"canal" | "chat">("chat");

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
  const indice = selecionada ? messages.findIndex((m) => m.id === selecionada) : -1;

  function correr(
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    onde: "canal" | "mensagem",
  ) {
    const setar = onde === "canal" ? setErroCanal : setErroMensagem;
    setar(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setar(r.error);
    });
  }

  function selecionar(id: string) {
    const alvo = messages.find((m) => m.id === id);
    if (!alvo) return;
    setSelecionada(id);
    setRascunho(paraInput(alvo));
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-56px)] md:h-[calc(100vh-theme(spacing.14))]">
      <header className="shrink-0 p-4 md:px-6 md:py-4 border-b border-(--border-subtle) flex flex-wrap items-center justify-between gap-3 bg-(--bg-body) z-10">
        <div>
          <h1 className="text-xl font-semibold text-(--text-primary)">Prova Social</h1>
          <p className="text-sm text-(--text-muted) hidden md:block">
            Monte a prévia do canal que aparecerá no seu Mini App.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            whileHover={{ scale: pending ? 1 : 1.02 }}
            whileTap={{ scale: pending ? 1 : 0.98 }}
            type="button"
            onClick={() => correr(() => saveChannel(botId, canal), "canal")}
            disabled={pending}
            className="relative flex items-center justify-center overflow-hidden rounded-lg bg-(--accent) px-4 py-2 text-sm font-semibold text-(--on-accent) disabled:opacity-80 transition-opacity"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {pending ? (
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
        </div>
      </header>

      {/* Navegação Mobile */}
      <div className="md:hidden flex p-2 bg-(--bg-overlay) border-b border-(--border-subtle) shrink-0">
        <button 
          onClick={() => setMobileTab("canal")} 
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mobileTab === "canal" ? "bg-(--accent) text-(--on-accent)" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
        >
          Canal
        </button>
        <button 
          onClick={() => setMobileTab("chat")} 
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mobileTab === "chat" ? "bg-(--accent) text-(--on-accent)" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
        >
          Chat
        </button>
      </div>

      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 p-4 md:p-6 overflow-hidden">
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

          <div className="h-full grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)_340px] xl:grid-cols-[320px_minmax(0,1fr)_400px] gap-4 md:gap-6 relative">
            
            {/* Coluna 1: Canal */}
            <div className={`h-full overflow-y-auto pr-2 custom-scrollbar space-y-4 pb-10 ${mobileTab === "canal" ? "block" : "hidden md:block"}`}>
              <ChannelCard value={canal} onChange={setCanal} />
              <OwnerCard value={canal} onChange={setCanal} />
            </div>

            {/* Coluna 2: Preview do Chat */}
            <div className={`h-full flex-col items-center overflow-hidden pb-10 ${mobileTab === "chat" ? "flex" : "hidden md:flex"}`}>
              <FeedPreview
                channel={canal}
                messages={messages}
                draft={rascunho}
                pinnedText={pinnedText}
                selectedId={selecionada}
                disabled={pending}
                onSelect={selecionar}
                onReorder={(ids) => correr(() => reorderMessages(botId, ids), "mensagem")}
                onDuplicate={(id) => correr(() => duplicateMessage(id, botId), "mensagem")}
                onPin={(id) =>
                  correr(() => setPinnedMessage(botId, pinnedId === id ? null : id), "mensagem")
                }
                onDelete={(id) => {
                  correr(() => deleteMessage(id, botId), "mensagem");
                  if (selecionada === id) {
                    setSelecionada(null);
                    setRascunho(null);
                  }
                }}
              />
              
              <div className="shrink-0 w-full flex flex-col items-center mt-2">
                <QuickCompose
                  senderKind={senderRapido}
                  onSenderKindChange={setSenderRapido}
                  disabled={pending}
                  onSend={async (text) => {
                    setErroMensagem(null);
                    const r = await saveMessage(botId, {
                      ...mensagemVazia(senderRapido),
                      content_text: text,
                    });
                    if (!r.ok) {
                      setErroMensagem(r.error);
                      return false;
                    }
                    return true;
                  }}
                />
                
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setSelecionada(null);
                    setErroMensagem(null);
                    setRascunho(mensagemVazia());
                  }}
                  className="mt-3 w-full max-w-[380px] rounded-xl border border-dashed border-(--border-default) py-3 text-sm font-medium text-(--text-secondary) hover:border-(--accent) hover:text-(--text-primary) transition-colors bg-(--bg-overlay) disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + Nova mensagem detalhada
                </button>
              </div>

              {/* Ações da linha e da composição rápida funcionam sem editor aberto,
                  e nesse estado o MessageEditor não existe pra mostrar o erro. */}
              <AnimatePresence>
                {!rascunho && erroMensagem && (
                  <motion.p
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={{ opacity: 1, height: "auto", marginTop: 12 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                    className="w-full max-w-[380px] rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red) overflow-hidden shrink-0 mt-2"
                  >
                    {erroMensagem}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Coluna 3: Editor (Mobile como overlay fixo, Desktop como 3ª coluna) */}
            <AnimatePresence mode="popLayout">
              {rascunho ? (
                <motion.div
                  key="editor"
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                  className="absolute inset-0 z-50 bg-(--bg-body)/95 backdrop-blur-md md:static md:bg-transparent md:z-auto h-full overflow-y-auto pl-2 custom-scrollbar pb-10"
                >
                  <MessageEditor
                    value={rascunho}
                    index={indice >= 0 ? indice : messages.length}
                    onChange={setRascunho}
                    saving={pending}
                    error={erroMensagem}
                    onSave={() => correr(() => saveMessage(botId, rascunho), "mensagem")}
                    onDuplicate={() => {
                      if (selecionada) correr(() => duplicateMessage(selecionada, botId), "mensagem");
                    }}
                    onReply={() => {
                      setRascunho({ ...mensagemVazia(), reply_to_id: selecionada });
                      setSelecionada(null);
                      setErroMensagem(null);
                    }}
                    onPin={() => {
                      if (selecionada) {
                        correr(
                          () => setPinnedMessage(botId, pinnedId === selecionada ? null : selecionada),
                          "mensagem",
                        );
                      }
                    }}
                    onDelete={() => {
                      if (!selecionada) {
                        setRascunho(null);
                        return;
                      }
                      correr(() => deleteMessage(selecionada, botId), "mensagem");
                      setSelecionada(null);
                      setRascunho(null);
                    }}
                  />
                  {/* Botão de fechar só visível no mobile */}
                  <button 
                    onClick={() => {
                      setSelecionada(null);
                      setRascunho(null);
                    }}
                    className="md:hidden mt-6 w-full rounded-lg bg-zinc-800 py-3 text-white font-medium"
                  >
                    Fechar Editor
                  </button>
                </motion.div>
              ) : (
                <motion.aside
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="hidden md:flex items-center justify-center rounded-xl border border-dashed border-(--border-subtle) p-8 text-center text-sm text-(--text-muted) w-full h-fit py-20 bg-(--bg-input)/50"
                >
                  Selecione ou crie uma mensagem para editar seus detalhes.
                </motion.aside>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
    </div>
  );
}
