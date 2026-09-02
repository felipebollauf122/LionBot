"use client";

import { useState, useTransition } from "react";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
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
import { MessageList } from "@/components/dashboard/social-proof/message-list";
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
  // Dois estados de erro em vez de um: falha ao salvar o canal aparece no
  // banner do topo, falha ao salvar a mensagem aparece no editor — perto do
  // botão que a causou. Um banner só empurraria o erro pra longe da ação.
  const [erroCanal, setErroCanal] = useState<string | null>(null);
  const [erroMensagem, setErroMensagem] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<MessageInput | null>(null);
  const [senderRapido, setSenderRapido] = useState<SenderKind>("owner");

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

  /**
   * Roda uma action e mostra o erro dela sem lançar.
   * `onde` escolhe qual superfície recebe a mensagem.
   */
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
    <div className="p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-(--text-primary)">Prova Social</h1>
          <p className="text-sm text-(--text-muted)">
            Monte a prévia do canal que aparecerá no seu Mini App.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/mini/${botId}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-(--border-default) px-3 py-2 text-sm text-(--text-secondary)"
          >
            Visualizar Mini App
          </a>
          <button
            type="button"
            onClick={() => correr(() => saveChannel(botId, canal), "canal")}
            disabled={pending}
            className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--on-accent) disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </header>

      {erroCanal && (
        <p className="mb-4 rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
          {erroCanal}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_400px]">
        <div className="space-y-4">
          <ChannelCard value={canal} onChange={setCanal} />
          <OwnerCard value={canal} onChange={setCanal} />
          <MessageList
            messages={messages}
            selectedId={selecionada}
            pinnedId={pinnedId}
            disabled={pending}
            onSelect={selecionar}
            onReorder={(ids) => correr(() => reorderMessages(botId, ids), "mensagem")}
            onDuplicate={(id) => correr(() => duplicateMessage(id, botId), "mensagem")}
            // Fixar a que já está fixada desafixa — é o par natural do rótulo
            // "Desafixar" que a lista mostra nesse caso.
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
            onNew={() => {
              setSelecionada(null);
              setErroMensagem(null);
              setRascunho(mensagemVazia());
            }}
          />
        </div>

        <div className="flex flex-col items-center">
          <FeedPreview
            channel={canal}
            messages={messages}
            draft={rascunho}
            pinnedText={pinnedText}
          />
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
          {/* Ações da linha e da composição rápida funcionam sem editor aberto,
              e nesse estado o MessageEditor não existe pra mostrar o erro. */}
          {!rascunho && erroMensagem && (
            <p className="mt-3 w-full max-w-[380px] rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
              {erroMensagem}
            </p>
          )}
        </div>

        {rascunho ? (
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
              // Responder abre um rascunho NOVO. Sem zerar `selecionada`, o
              // editor mostra formulário vazio enquanto "Excluir" ainda mira a
              // mensagem original — e a apaga sem confirmação nenhuma.
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
        ) : (
          <aside className="flex items-center justify-center rounded-xl border border-dashed border-(--border-subtle) p-8 text-center text-sm text-(--text-muted)">
            Selecione ou crie uma mensagem para editar seus detalhes.
          </aside>
        )}
      </div>
    </div>
  );
}
