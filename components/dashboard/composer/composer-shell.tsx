"use client";

import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { ChannelInput, MessageInput, SenderKind } from "@/lib/social-proof/types";
import type { ComposerActions, ComposerMessageRow } from "@/lib/composer/types";
import { normalizeReactions } from "@/lib/social-proof/reactions";
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

function paraInput(m: ComposerMessageRow): MessageInput {
  return {
    id: m.id,
    sender_kind: m.sender_kind === "owner" ? "owner" : "member",
    sender_name: m.sender_name ?? "",
    sender_avatar_url: m.sender_avatar_url ?? null,
    kind: m.kind as MessageInput["kind"],
    content_text: m.content_text,
    media: Array.isArray(m.media) ? m.media : [],
    reactions: normalizeReactions(m.reactions),
    reply_to_id: m.reply_to_id,
    display_time: m.display_time ?? null,
    // Os três últimos são da Prova Social. Uma linha de campanha não os traz,
    // e o editor dela não os mostra — o zero aqui é só o que preenche o campo.
    offset_seconds: m.offset_seconds ?? 0,
    views_count: m.views_count ?? 0,
    // E estes dois são só da campanha: sem eles, abrir uma mensagem já salva
    // mostraria a cadência padrão em vez da dela, e salvar de volta zeraria a
    // espera real. Na Prova Social a linha não os tem, viram `undefined`, e
    // nem o editor nem a action dela olham pra eles.
    delay_seconds: m.delay_seconds ?? undefined,
    silent: m.silent ?? undefined,
  };
}

/**
 * As três colunas do composer — identidade, prévia do Telegram, editor — sem
 * saber de que feature são. Quem monta a coluna 1, o cabeçalho e os campos
 * extras do editor é o adaptador; as gravações chegam por `actions`.
 */
export function ComposerShell({
  actions,
  messages,
  channel,
  title,
  subtitle,
  pinnedId = null,
  pinnedText = "",
  headerActions,
  notice,
  leftColumn,
  leftColumnLabel = "Canal",
  editorExtras,
  messageBadge,
  now,
  emptyEditorHint = "Selecione ou crie uma mensagem para editar seus detalhes.",
  busy = false,
}: {
  actions: ComposerActions;
  messages: ComposerMessageRow[];
  /** Identidade usada pelo cabeçalho da prévia. */
  channel: ChannelInput;
  title: string;
  subtitle: string;
  /** Mensagem fixada. Ausente = a feature não fixa nada (a campanha não fixa). */
  pinnedId?: string | null;
  pinnedText?: string;
  /** Botões do canto superior direito (Visualizar, Salvar, Publicar…). */
  headerActions?: ReactNode;
  /** Faixa acima das colunas: cada feature mostra ali o erro que é dela
   *  (o do canal, na Prova Social) — o erro de mensagem é do shell. */
  notice?: ReactNode;
  /** Coluna 1. Prova Social passa ChannelCard+OwnerCard; campanha, os cards dela. */
  leftColumn: ReactNode;
  /** Rótulo da aba mobile da coluna 1. */
  leftColumnLabel?: string;
  /** Campos extras do editor, específicos da feature. */
  editorExtras?: (value: MessageInput, onChange: (v: MessageInput) => void) => ReactNode;
  /** Chip por mensagem no preview (status de envio, na campanha). Desce até o
   *  ChannelFeed, que o desenha logo abaixo da bolha. Ausente, como na Prova
   *  Social, não acrescenta nada ao DOM. */
  messageBadge?: (row: ComposerMessageRow) => ReactNode;
  /** Momento de referência do preview. Ausente = o agora, que é o caso da
   *  Prova Social; a campanha ancora na última postagem da sequência. */
  now?: Date;
  emptyEditorHint?: string;
  /**
   * Trabalho EM VOO do adaptador, fora do transition deste shell.
   *
   * Antes do refactor a Prova Social tinha um `useTransition` só, e salvar o
   * canal travava a tela inteira. Ao dividir em dois (um aqui, outro no
   * SocialProofComposer) a prévia, a composição rápida e o editor ficaram
   * vivos durante o salvamento do canal — e na configuração inicial dava pra
   * mandar uma mensagem antes de a linha do canal existir, recebendo "Salve
   * os dados do canal antes de criar mensagens.", um erro que a UI antiga
   * tornava inalcançável. Quem tem transition próprio devolve o `pending`
   * dele por aqui.
   */
  busy?: boolean;
}) {
  const [pending, start] = useTransition();
  const [erroMensagem, setErroMensagem] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<MessageInput | null>(null);
  const [senderRapido, setSenderRapido] = useState<SenderKind>("owner");
  const [mobileTab, setMobileTab] = useState<"canal" | "chat">("chat");

  // Uma trava só pra tela inteira: o transition deste shell OU o do
  // adaptador. É o que o `useTransition` único garantia antes do refactor.
  const ocupado = pending || busy;

  const indice = selecionada ? messages.findIndex((m) => m.id === selecionada) : -1;

  // Em variável, e não `actions.setPinned` direto: assim o TypeScript mantém o
  // estreitamento dentro dos callbacks, sem `!` em cima de uma prop opcional.
  const setPinned = actions.setPinned;

  function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setErroMensagem(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErroMensagem(r.error);
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
          <h1 className="text-xl font-semibold text-(--text-primary)">{title}</h1>
          <p className="text-sm text-(--text-muted) hidden md:block">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">{headerActions}</div>
      </header>

      {/* Navegação Mobile */}
      <div className="md:hidden flex p-2 bg-(--bg-overlay) border-b border-(--border-subtle) shrink-0">
        <button
          onClick={() => setMobileTab("canal")}
          className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${mobileTab === "canal" ? "bg-(--accent) text-(--on-accent)" : "text-(--text-secondary) hover:text-(--text-primary)"}`}
        >
          {leftColumnLabel}
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
          {notice}

          <div className="h-full grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)_340px] xl:grid-cols-[320px_minmax(0,1fr)_400px] gap-4 md:gap-6 relative">

            {/* Coluna 1: Canal */}
            <div className={`h-full overflow-y-auto pr-2 custom-scrollbar space-y-4 pb-10 ${mobileTab === "canal" ? "block" : "hidden md:block"}`}>
              {leftColumn}
            </div>

            {/* Coluna 2: Preview do Chat */}
            <div className={`h-full flex-col items-center overflow-hidden pb-10 ${mobileTab === "chat" ? "flex" : "hidden md:flex"}`}>
              <FeedPreview
                channel={channel}
                messages={messages}
                draft={rascunho}
                pinnedText={pinnedText}
                pinnedId={pinnedId}
                selectedId={selecionada}
                disabled={ocupado}
                onSelect={selecionar}
                messageBadge={messageBadge}
                now={now}
                onReorder={(ids) => correr(() => actions.reorderMessages(ids))}
                onDuplicate={(id) => correr(() => actions.duplicateMessage(id))}
                onPin={
                  setPinned
                    ? (id) => correr(() => setPinned(pinnedId === id ? null : id))
                    : undefined
                }
                onDelete={(id) => {
                  correr(() => actions.deleteMessage(id));
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
                  disabled={ocupado}
                  onSend={async (text) => {
                    // O `disabled` acima cobre o botão; o Enter no textarea
                    // chega aqui direto. Enviar durante um salvamento do
                    // canal é justamente o que faz a mensagem chegar antes da
                    // linha do canal existir.
                    if (ocupado) return false;
                    setErroMensagem(null);
                    const r = await actions.saveMessage({
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
                  disabled={ocupado}
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
                    saving={ocupado}
                    error={erroMensagem}
                    extras={editorExtras?.(rascunho, setRascunho)}
                    onSave={() => correr(() => actions.saveMessage(rascunho))}
                    onDuplicate={() => {
                      if (selecionada) correr(() => actions.duplicateMessage(selecionada));
                    }}
                    onReply={() => {
                      setRascunho({ ...mensagemVazia(), reply_to_id: selecionada });
                      setSelecionada(null);
                      setErroMensagem(null);
                    }}
                    onPin={
                      setPinned
                        ? () => {
                            if (selecionada) {
                              correr(() =>
                                setPinned(pinnedId === selecionada ? null : selecionada),
                              );
                            }
                          }
                        : undefined
                    }
                    onDelete={() => {
                      if (!selecionada) {
                        setRascunho(null);
                        return;
                      }
                      correr(() => actions.deleteMessage(selecionada));
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
                  {emptyEditorHint}
                </motion.aside>
              )}
            </AnimatePresence>

          </div>
        </div>
      </div>
    </div>
  );
}
