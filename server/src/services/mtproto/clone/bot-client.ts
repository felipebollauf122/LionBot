import { Api } from "telegram";
import { Bot, InputFile } from "grammy";
import { config } from "../../../config.js";
import { MtprotoClient } from "../client.js";
import type { CloneMediaKind } from "./media-plan.js";

export interface BotValidationDeps {
  getMe(token: string): Promise<{ id: number; username?: string; is_bot: boolean }>;
}

export type BotValidation =
  | { ok: true; botUserId: string; username: string }
  | { ok: false; error: string };

export const defaultBotValidationDeps: BotValidationDeps = {
  getMe: async (token) => {
    const me = await new Bot(token).api.getMe();
    return { id: me.id, username: me.username, is_bot: me.is_bot };
  },
};

/**
 * Valida o token colado pelo owner. Username é obrigatório porque a promoção
 * a admin resolve o bot por @username (contacts.ResolveUsername).
 */
export async function validateBotToken(
  token: string,
  deps: BotValidationDeps = defaultBotValidationDeps,
): Promise<BotValidation> {
  if (!token || !token.trim()) return { ok: false, error: "token_vazio" };
  try {
    const me = await deps.getMe(token.trim());
    if (!me.is_bot) return { ok: false, error: "nao_e_bot" };
    if (!me.username) return { ok: false, error: "bot_sem_username" };
    return { ok: true, botUserId: String(me.id), username: me.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface InlineLink {
  label: string;
  url: string;
}

/**
 * Só botões de URL sobrevivem à clonagem: callback pertence ao bot que criou
 * a mensagem original e não funciona fora dele.
 */
export function buildInlineKeyboard(links: InlineLink[]): {
  inline_keyboard: Array<Array<{ text: string; url: string }>>;
} {
  return {
    inline_keyboard: links
      .filter((l) => /^https?:\/\//i.test(l.url))
      .map((l) => [{ text: l.label, url: l.url }]),
  };
}

export interface PublishOptions {
  replyToMessageId?: number;
  entities?: unknown[];
  inlineLinks?: InlineLink[];
}

/**
 * Publicador do clone. Bot API para o caso comum; cliente MTProto de bot
 * apenas para o que a Bot API não cobre.
 */
export class CompanionBot {
  private bot: Bot;
  private mt: MtprotoClient | null = null;

  constructor(
    private token: string,
    /** chat_id no formato do Bot API: -100<channelId> para canal/supergrupo. */
    private destChatId: string,
    private sessionString: string | null = null,
  ) {
    this.bot = new Bot(token);
  }

  static destChatIdFromChannelId(channelId: string): string {
    return `-100${channelId}`;
  }

  async publishText(text: string, opts: PublishOptions = {}): Promise<number> {
    const sent = await this.bot.api.sendMessage(this.destChatId, text, {
      entities: opts.entities as never,
      link_preview_options: { is_disabled: false },
      reply_parameters: opts.replyToMessageId
        ? { message_id: opts.replyToMessageId }
        : undefined,
      reply_markup: opts.inlineLinks?.length
        ? buildInlineKeyboard(opts.inlineLinks)
        : undefined,
      disable_notification: true,
    });
    return sent.message_id;
  }

  async publishMedia(
    filePath: string,
    kind: CloneMediaKind,
    caption: string,
    opts: PublishOptions = {},
  ): Promise<number> {
    const file = new InputFile(filePath);
    const common = {
      caption: caption || undefined,
      caption_entities: opts.entities as never,
      reply_parameters: opts.replyToMessageId
        ? { message_id: opts.replyToMessageId }
        : undefined,
      reply_markup: opts.inlineLinks?.length
        ? buildInlineKeyboard(opts.inlineLinks)
        : undefined,
      disable_notification: true,
    };
    const api = this.bot.api;
    const sent =
      kind === "photo"
        ? await api.sendPhoto(this.destChatId, file, common)
        : kind === "video"
          ? await api.sendVideo(this.destChatId, file, common)
          : kind === "audio"
            ? await api.sendAudio(this.destChatId, file, common)
            : kind === "animation"
              ? await api.sendAnimation(this.destChatId, file, common)
              : kind === "sticker"
                ? await api.sendSticker(this.destChatId, file, {
                    reply_parameters: common.reply_parameters,
                    disable_notification: true,
                  })
                : await api.sendDocument(this.destChatId, file, common);
    return sent.message_id;
  }

  /** Álbum. O caller já fatiou em no máximo 10 itens. */
  async publishAlbum(
    items: Array<{ filePath: string; kind: "photo" | "video"; caption: string }>,
  ): Promise<number[]> {
    const media = items.map((it) => ({
      type: it.kind,
      media: new InputFile(it.filePath),
      caption: it.caption || undefined,
    }));
    const sent = await this.bot.api.sendMediaGroup(this.destChatId, media as never, {
      disable_notification: true,
    });
    return sent.map((m) => m.message_id);
  }

  async pin(messageId: number): Promise<void> {
    await this.bot.api.pinChatMessage(this.destChatId, messageId, {
      disable_notification: true,
    });
  }

  /**
   * Cliente MTProto autenticado como bot, para o que a Bot API não faz.
   * Devolve também a session string, para persistir em automation_bots.
   */
  async mtproto(): Promise<{ client: MtprotoClient; sessionString: string }> {
    if (!this.mt) {
      this.mt = new MtprotoClient(
        config.telegramApiId,
        config.telegramApiHash,
        this.sessionString ?? "",
      );
      if (!this.sessionString) {
        this.sessionString = await this.mt.signInAsBot(this.token);
      } else {
        await this.mt.connect();
      }
    }
    return { client: this.mt, sessionString: this.sessionString! };
  }

  async disconnect(): Promise<void> {
    await this.mt?.disconnect().catch(() => {});
    this.mt = null;
  }
}

/** Reexport para o cloner montar entities sem importar gramjs direto. */
export { Api };
