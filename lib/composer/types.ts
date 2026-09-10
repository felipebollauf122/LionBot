import type { ActionResult, MediaItem, MessageInput, Reaction } from "@/lib/social-proof/types";

/**
 * A linha que o preview do composer sabe desenhar, servindo às duas features.
 *
 * Os campos do primeiro bloco existem nas duas tabelas. Os do segundo são só
 * da Prova Social: a campanha não os tem porque o canal posta como ele mesmo,
 * o bot não consegue reagir e ninguém finge horário — o horário dela vem do
 * scheduled_at real, convertido em offset pela página.
 */
export interface ComposerMessageRow {
  id: string;
  kind: string;
  content_text: string | null;
  media: MediaItem[] | unknown;
  reply_to_id: string | null;

  sender_kind?: string | null;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
  reactions?: Reaction[] | unknown;
  offset_seconds?: number | null;
  views_count?: number | null;
  display_time?: string | null;
  /** Legado da 071, antes de `media` virar lista. Só a Prova Social tem. */
  media_url?: string | null;
  media_type?: string | null;
  /**
   * Nome do arquivo original. Só `mtproto_scheduled_messages` tem — é o que
   * dá nome ao chip de uma linha `kind: "document"` (ver toFeedMessage).
   */
  file_name?: string | null;
  /**
   * Cadência e modo silencioso, também só de `mtproto_scheduled_messages`.
   * Estão aqui porque o editor da campanha os mostra e regrava: sem eles a
   * tela exibiria a cadência padrão no lugar da real e a devolveria zerada ao
   * salvar. A Prova Social não os tem, e não olha pra eles.
   */
  delay_seconds?: number | null;
  silent?: boolean | null;
}

/**
 * As operações que o composer dispara. Injetadas para o shell não conhecer
 * nem a Prova Social nem a campanha.
 */
export type AiAssistAction = "rewrite" | "caption" | "summarize";

export interface ComposerActions {
  saveMessage(input: MessageInput): Promise<ActionResult>;
  deleteMessage(id: string): Promise<ActionResult>;
  duplicateMessage(id: string): Promise<ActionResult>;
  reorderMessages(orderedIds: string[]): Promise<ActionResult>;
  /** Ausente = a feature não tem mensagem fixada. */
  setPinned?(id: string | null): Promise<ActionResult>;
  /** Ausente = a feature não tem assistente de IA (Plano 3 liga na campanha). */
  aiAssist?(id: string, action: AiAssistAction): Promise<ActionResult>;
}
