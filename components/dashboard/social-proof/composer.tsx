"use client";

import { useState, useTransition } from "react";
import type { SocialProofChannel, SocialProofMessage } from "@/lib/types/database";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";
import {
  saveChannel,
  saveMessage,
  deleteMessage,
} from "@/lib/actions/social-proof-actions";
import { FeedPreview } from "@/components/dashboard/social-proof/feed-preview";

const CAMPO =
  "w-full rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)";

export function SocialProofComposer({
  botId,
  channel,
  messages,
}: {
  botId: string;
  channel: SocialProofChannel | null;
  messages: SocialProofMessage[];
}) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const [canal, setCanal] = useState<ChannelInput>({
    title: channel?.title ?? "",
    avatar_url: channel?.avatar_url ?? null,
    subscribers_label: channel?.subscribers_label ?? "",
    is_verified: channel?.is_verified ?? false,
    is_active: channel?.is_active ?? false,
  });

  const [nova, setNova] = useState<MessageInput>({
    sender_name: "",
    sender_avatar_url: null,
    content_text: "",
    media_url: null,
    media_type: null,
    offset_seconds: 600,
    views_count: 0,
  });

  function salvarCanal() {
    setErro(null);
    start(async () => {
      const r = await saveChannel(botId, canal);
      if (!r.ok) setErro(r.error);
    });
  }

  function salvarMensagem() {
    setErro(null);
    start(async () => {
      const r = await saveMessage(botId, nova);
      if (!r.ok) {
        setErro(r.error);
        return;
      }
      // Sem `position`: quem numera é a action (max+1 do canal). O contador
      // que existia aqui colidia depois de apagar uma mensagem do meio.
      setNova({ ...nova, content_text: "", media_url: null, media_type: null });
    });
  }

  function apagar(id: string) {
    setErro(null);
    start(async () => {
      const r = await deleteMessage(id, botId);
      if (!r.ok) setErro(r.error);
    });
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-(--text-primary)">Prova Social</h1>

      {erro && (
        <p className="rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
          {erro}
        </p>
      )}

      <section className="space-y-3 rounded-xl border border-(--border-subtle) p-4">
        <h2 className="text-sm font-semibold text-(--text-secondary)">Canal</h2>

        <input
          className={CAMPO}
          placeholder="Nome do canal"
          value={canal.title}
          onChange={(e) => setCanal({ ...canal, title: e.target.value })}
        />
        <input
          className={CAMPO}
          placeholder="URL do avatar do canal"
          value={canal.avatar_url ?? ""}
          onChange={(e) => setCanal({ ...canal, avatar_url: e.target.value || null })}
        />
        <input
          className={CAMPO}
          placeholder="Linha de inscritos (ex.: 12 483 inscritos)"
          value={canal.subscribers_label}
          onChange={(e) => setCanal({ ...canal, subscribers_label: e.target.value })}
        />

        <label className="flex items-center gap-2 text-sm text-(--text-secondary)">
          <input
            type="checkbox"
            checked={canal.is_verified}
            onChange={(e) => setCanal({ ...canal, is_verified: e.target.checked })}
          />
          Selo de verificado
        </label>

        <label className="flex items-center gap-2 text-sm text-(--text-secondary)">
          <input
            type="checkbox"
            checked={canal.is_active}
            onChange={(e) => setCanal({ ...canal, is_active: e.target.checked })}
          />
          Ativo — o Mini App só abre com isto marcado
        </label>

        <button
          onClick={salvarCanal}
          disabled={pending}
          className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--on-accent) disabled:opacity-50"
        >
          Salvar canal
        </button>
      </section>

      <section className="space-y-3 rounded-xl border border-(--border-subtle) p-4">
        <h2 className="text-sm font-semibold text-(--text-secondary)">Nova mensagem</h2>

        <input
          className={CAMPO}
          placeholder="Nome do remetente"
          value={nova.sender_name}
          onChange={(e) => setNova({ ...nova, sender_name: e.target.value })}
        />
        <input
          className={CAMPO}
          placeholder="URL do avatar do remetente"
          value={nova.sender_avatar_url ?? ""}
          onChange={(e) => setNova({ ...nova, sender_avatar_url: e.target.value || null })}
        />
        <textarea
          className={CAMPO}
          rows={3}
          placeholder="Texto da mensagem"
          value={nova.content_text ?? ""}
          onChange={(e) => setNova({ ...nova, content_text: e.target.value })}
        />
        <input
          className={CAMPO}
          placeholder="URL da mídia (opcional)"
          value={nova.media_url ?? ""}
          onChange={(e) => setNova({ ...nova, media_url: e.target.value || null })}
        />

        <select
          className={CAMPO}
          value={nova.media_type ?? ""}
          onChange={(e) =>
            setNova({ ...nova, media_type: (e.target.value || null) as "image" | "video" | null })
          }
        >
          <option value="">Sem mídia</option>
          <option value="image">Imagem</option>
          <option value="video">Vídeo</option>
        </select>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-(--text-muted)">
            Há quantos minutos
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={Math.round(nova.offset_seconds / 60)}
              onChange={(e) =>
                setNova({ ...nova, offset_seconds: Math.max(0, Number(e.target.value)) * 60 })
              }
            />
          </label>

          <label className="text-xs text-(--text-muted)">
            Visualizações
            <input
              className={CAMPO}
              type="number"
              min={0}
              value={nova.views_count}
              onChange={(e) => setNova({ ...nova, views_count: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        </div>

        <button
          onClick={salvarMensagem}
          disabled={pending}
          className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-medium text-(--on-accent) disabled:opacity-50"
        >
          Adicionar mensagem
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-(--text-secondary)">
          Mensagens ({messages.length})
        </h2>

        {messages.length === 0 && (
          <p className="text-sm text-(--text-muted)">Nenhuma mensagem ainda.</p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className="flex items-start gap-3 rounded-lg border border-(--border-subtle) p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-(--text-primary)">{m.sender_name}</p>
              <p className="truncate text-sm text-(--text-secondary)">
                {m.content_text ?? `[${m.media_type}]`}
              </p>
              <p className="text-xs text-(--text-muted)">
                {Math.round(m.offset_seconds / 60)} min atrás · {m.views_count} views
              </p>
            </div>
            <button
              onClick={() => apagar(m.id)}
              disabled={pending}
              className="text-xs text-(--red) disabled:opacity-50"
            >
              Apagar
            </button>
          </div>
        ))}
      </section>

      <FeedPreview channel={canal} messages={messages} draft={nova} />
    </div>
  );
}
