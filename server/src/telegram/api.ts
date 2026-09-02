import {
  cacheVoiceFileId,
  forgetVoiceFileId,
  getCachedVoiceFileId,
  toOpusVoice,
} from "./voice-opus.js";

export interface SendMessageParams {
  chatId: number;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export interface SendPhotoParams {
  chatId: number;
  photo: string; // URL
  caption?: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export interface SendVideoParams {
  chatId: number;
  video: string; // URL or file_id
  caption?: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export interface SendVoiceParams {
  chatId: number;
  voice: string; // URL or file_id
  caption?: string;
  /** Duração em segundos — o Telegram exibe na bolha antes mesmo do download. */
  duration?: number;
  replyMarkup?: InlineKeyboardMarkup;
}

/** Ações de chat suportadas (as que fazem sentido no engine). */
export type ChatAction = "typing" | "record_voice" | "upload_voice" | "upload_photo" | "upload_video";

export type InlineKeyboardButtonStyle = "danger" | "success" | "primary";

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  copy_text?: { text: string };
  /**
   * Abre um Mini App dentro do Telegram (Bot API 6.0+).
   *
   * A URL precisa ser HTTPS público. Diferente de `url`, é o `web_app` que faz
   * o Telegram injetar initData e as variáveis de tema — com `url` o Mini App
   * vira um site comum num webview, sem tema nativo e sem identificação.
   */
  web_app?: { url: string };
  /**
   * Cor do botão (Bot API 8.x+).
   *   danger  → vermelho
   *   success → verde
   *   primary → azul
   * Omitido = cor padrão do tema do cliente.
   */
  style?: InlineKeyboardButtonStyle;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

export class TelegramApi {
  private baseUrl: string;
  private protectContent: boolean;

  constructor(private token: string, options: { protectContent?: boolean } = {}) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.protectContent = options.protectContent ?? false;
  }

  get botToken(): string {
    return this.token;
  }

  async sendMessage(params: SendMessageParams): Promise<TelegramMessage | null> {
    const text = params.text?.trim();
    if (!text) {
      console.warn("[telegram] Skipping sendMessage: empty text");
      return null;
    }
    const body: Record<string, unknown> = {
      chat_id: params.chatId,
      text,
      parse_mode: "HTML",
    };
    if (params.replyMarkup) {
      body.reply_markup = params.replyMarkup;
    }
    if (this.protectContent) {
      body.protect_content = true;
    }
    const result = await this.request("sendMessage", body);
    return result as TelegramMessage | null;
  }

  async sendPhoto(params: SendPhotoParams): Promise<TelegramMessage | null> {
    if (!params.photo?.trim()) {
      console.warn("[telegram] Skipping sendPhoto: empty photo URL");
      return null;
    }
    const body: Record<string, unknown> = {
      chat_id: params.chatId,
      photo: params.photo,
      parse_mode: "HTML",
    };
    if (params.caption) {
      body.caption = params.caption;
    }
    if (params.replyMarkup) {
      body.reply_markup = params.replyMarkup;
    }
    if (this.protectContent) {
      body.protect_content = true;
    }
    const result = await this.request("sendPhoto", body);
    return result as TelegramMessage | null;
  }

  async sendVideo(params: SendVideoParams): Promise<TelegramMessage | null> {
    if (!params.video?.trim()) {
      console.warn("[telegram] Skipping sendVideo: empty video URL");
      return null;
    }
    const body: Record<string, unknown> = {
      chat_id: params.chatId,
      video: params.video,
      parse_mode: "HTML",
    };
    if (params.caption) {
      body.caption = params.caption;
    }
    if (params.replyMarkup) {
      body.reply_markup = params.replyMarkup;
    }
    if (this.protectContent) {
      body.protect_content = true;
    }
    try {
      const result = await this.request("sendVideo", body);
      return result as TelegramMessage | null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // O fetcher da Telegram às vezes não reconhece o Content-Type do CDN de
      // origem (proxy, redirect, headers atípicos) e cai no fluxo de preview
      // de "web page", que rejeita o conteúdo por não parecer vídeo direto.
      // Baixamos o arquivo no nosso servidor e reenviamos como upload
      // multipart, contornando o fetch da Telegram por completo.
      if (/wrong type of the web page content|failed to get http url content/i.test(msg)) {
        console.warn(`[telegram] sendVideo por URL falhou (${msg}), tentando upload direto`);
        return await this.sendVideoAsUpload(params, body);
      }
      throw error;
    }
  }

  private async sendVideoAsUpload(
    params: SendVideoParams,
    body: Record<string, unknown>,
  ): Promise<TelegramMessage | null> {
    const fileResponse = await fetch(params.video, { signal: AbortSignal.timeout(30_000) });
    if (!fileResponse.ok) {
      throw new Error(
        `Telegram API error (sendVideo): falha ao baixar vídeo da origem (HTTP ${fileResponse.status})`,
      );
    }
    const blob = await fileResponse.blob();

    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
      if (key === "video") continue;
      form.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    form.append("video", blob, "video.mp4");

    const result = await this.requestMultipart("sendVideo", form);
    return result as TelegramMessage | null;
  }

  /**
   * Envia áudio como MENSAGEM DE VOZ (bolha com waveform e play inline), e não
   * como arquivo/documento.
   *
   * A Bot API aceita MP3/M4A aqui, mas o cliente do Telegram só desenha a
   * bolha de voz quando o arquivo é OGG/OPUS — nos outros formatos ele cai pro
   * player de arquivo com nome e tamanho. Por isso o caminho normal é:
   * converter pra OPUS (voice-opus.ts) e subir multipart. O file_id devolvido
   * fica em cache, então só o primeiro lead de cada áudio paga o download +
   * conversão; os seguintes recebem por referência.
   *
   * Sem ffmpeg na máquina nada disso quebra: cai no envio do arquivo original,
   * que chega como anexo — feio, mas chega.
   */
  async sendVoice(params: SendVoiceParams): Promise<TelegramMessage | null> {
    if (!params.voice?.trim()) {
      console.warn("[telegram] Skipping sendVoice: empty voice URL");
      return null;
    }
    const source = params.voice.trim();
    const body: Record<string, unknown> = {
      chat_id: params.chatId,
      voice: source,
      parse_mode: "HTML",
    };
    if (params.caption) {
      body.caption = params.caption;
    }
    if (params.duration && params.duration > 0) {
      body.duration = Math.round(params.duration);
    }
    if (params.replyMarkup) {
      body.reply_markup = params.replyMarkup;
    }
    if (this.protectContent) {
      body.protect_content = true;
    }

    // file_id: o áudio já está nos servidores do Telegram (e já no formato em
    // que foi guardado) — manda por referência, sem baixar nada.
    if (!/^https?:\/\//i.test(source)) {
      return (await this.request("sendVoice", body)) as TelegramMessage | null;
    }

    // Do segundo envio em diante: reusa o OPUS que já subiu.
    const cachedFileId = getCachedVoiceFileId(this.token, source);
    if (cachedFileId) {
      try {
        return (await this.request("sendVoice", { ...body, voice: cachedFileId })) as TelegramMessage | null;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Só file_id inválido justifica reconverter; 429/rede/chat bloqueado
        // têm que subir como sempre.
        if (!/file identifier|file_id|file is temporarily unavailable/i.test(msg)) throw error;
        console.warn(`[telegram] file_id de voz em cache recusado (${msg}); reconvertendo.`);
        forgetVoiceFileId(this.token, source);
      }
    }

    const opus = await toOpusVoice(source);
    if (opus) {
      const sent = await this.uploadOpusVoice(body, opus);
      const fileId = (sent as { voice?: { file_id?: string } } | null)?.voice?.file_id;
      if (fileId) cacheVoiceFileId(this.token, source, fileId);
      return sent;
    }

    // Sem conversão possível: caminho antigo — URL direta e, se o fetcher da
    // Telegram recusar o Content-Type do CDN, upload do arquivo cru.
    try {
      const result = await this.request("sendVoice", body);
      return result as TelegramMessage | null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/wrong type of the web page content|failed to get http url content/i.test(msg)) {
        console.warn(`[telegram] sendVoice por URL falhou (${msg}), tentando upload direto`);
        return await this.sendVoiceAsUpload(params, body);
      }
      throw error;
    }
  }

  /** Último recurso quando não houve conversão: baixa a origem e sobe o
   *  arquivo cru. O fetcher da Telegram às vezes não reconhece o Content-Type
   *  do CDN e recusa buscar a URL sozinho. */
  private async sendVoiceAsUpload(
    params: SendVoiceParams,
    body: Record<string, unknown>,
  ): Promise<TelegramMessage | null> {
    const fileResponse = await fetch(params.voice, { signal: AbortSignal.timeout(30_000) });
    if (!fileResponse.ok) {
      throw new Error(
        `Telegram API error (sendVoice): falha ao baixar áudio da origem (HTTP ${fileResponse.status})`,
      );
    }
    const blob = await fileResponse.blob();

    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
      if (key === "voice") continue;
      form.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    // A extensão do nome importa: é por ela que o Telegram decide se aceita o
    // arquivo como voz. Preservar a da origem evita um .mp3 legítimo ser
    // rejeitado por chegar rotulado de "voice.ogg".
    form.append("voice", blob, voiceFileName(params.voice));

    const result = await this.requestMultipart("sendVoice", form);
    return result as TelegramMessage | null;
  }

  /** Sobe o OGG/OPUS já convertido. O nome "voice.ogg" é o que o Telegram
   *  espera pra tratar o upload como nota de voz. */
  private async uploadOpusVoice(
    body: Record<string, unknown>,
    opus: Buffer,
  ): Promise<TelegramMessage | null> {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
      if (key === "voice") continue;
      form.append(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    form.append("voice", new Blob([new Uint8Array(opus)], { type: "audio/ogg" }), "voice.ogg");

    const result = await this.requestMultipart("sendVoice", form);
    return result as TelegramMessage | null;
  }

  /**
   * "gravando áudio…" / "digitando…" no topo do chat. Some sozinho em ~5s (ou
   * quando chega a próxima mensagem), então quem quer um indicador mais longo
   * precisa re-emitir. Nunca lança: é enfeite, não pode derrubar o envio.
   */
  async sendChatAction(chatId: number, action: ChatAction): Promise<void> {
    try {
      await this.request("sendChatAction", { chat_id: chatId, action });
    } catch (error) {
      console.warn(`[telegram] sendChatAction(${action}) falhou:`, error instanceof Error ? error.message : error);
    }
  }

  async deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    try {
      await this.request("deleteMessage", {
        chat_id: chatId,
        message_id: messageId,
      });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // These are expected and harmless — silence them:
      //  - "message to delete not found": user already deleted it, or 48h window passed
      //  - "message can't be deleted": admin msgs, service msgs, etc.
      if (/message to delete not found|message can't be deleted/i.test(msg)) {
        return false;
      }
      console.error(`[telegram] Failed to delete message ${messageId}:`, error);
      return false;
    }
  }

  async setWebhook(url: string): Promise<void> {
    await this.request("setWebhook", { url });
  }

  async editMessageText(params: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: params.chatId,
      message_id: params.messageId,
      text: params.text,
      parse_mode: "HTML",
    };
    if (params.replyMarkup) body.reply_markup = params.replyMarkup;
    try {
      await this.request("editMessageText", body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "message is not modified" é benign — só ignoramos
      if (/message is not modified/i.test(msg)) return;
      throw err;
    }
  }

  async sendMessageWithReplyKeyboard(params: {
    chatId: number;
    text: string;
    keyboard: Array<Array<{ text: string; request_contact?: boolean }>>;
    oneTime?: boolean;
  }): Promise<TelegramMessage | null> {
    const body: Record<string, unknown> = {
      chat_id: params.chatId,
      text: params.text,
      parse_mode: "HTML",
      reply_markup: {
        keyboard: params.keyboard,
        resize_keyboard: true,
        one_time_keyboard: params.oneTime ?? true,
      },
    };
    if (this.protectContent) body.protect_content = true;
    const result = await this.request("sendMessage", body);
    return result as TelegramMessage | null;
  }

  async removeReplyKeyboard(chatId: number, text: string): Promise<TelegramMessage | null> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { remove_keyboard: true },
    };
    const result = await this.request("sendMessage", body);
    return result as TelegramMessage | null;
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.request("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text ?? undefined,
    });
  }

  async deleteWebhook(): Promise<void> {
    await this.request("deleteWebhook", {});
  }

  private async request(method: string, body: Record<string, unknown>): Promise<unknown> {
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 15_000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        const data = await response.json();
        if (!data.ok) {
          // Telegram 429 (rate limit) — wait and retry
          if (response.status === 429 && attempt < MAX_RETRIES) {
            const retryAfter = data.parameters?.retry_after ?? 1;
            console.warn(`[telegram] Rate limited on ${method}, retrying in ${retryAfter}s (attempt ${attempt}/${MAX_RETRIES})`);
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            continue;
          }
          throw new Error(`Telegram API error (${method}): ${data.description ?? "Unknown error"}`);
        }
        return data.result;
      } catch (error) {
        const isNetworkError =
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === "TimeoutError");

        if (isNetworkError && attempt < MAX_RETRIES) {
          const delay = attempt * 1000; // 1s, 2s
          console.warn(`[telegram] ${method} failed (${(error as Error).message}), retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Telegram API ${method}: all ${MAX_RETRIES} attempts failed`);
  }

  private async requestMultipart(method: string, form: FormData): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Telegram API error (${method}): ${data.description ?? "Unknown error"}`);
    }
    return data.result;
  }
}

/** Nome de arquivo para upload multipart de voz, preservando a extensão da
 *  origem quando ela é uma das aceitas pela Bot API. */
function voiceFileName(url: string): string {
  const ext = url.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "";
  return ["ogg", "oga", "mp3", "m4a"].includes(ext) ? `voice.${ext}` : "voice.ogg";
}
