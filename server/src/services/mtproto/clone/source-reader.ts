import { Api } from "telegram";
import bigInt from "big-integer";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { MtprotoClient } from "../client.js";
import { buildHistoryPeer } from "./history-iterator.js";
import type { HistorySource } from "./history-iterator.js";
import type { ClonePeer } from "./types.js";
import type { SourceIdentity } from "./dest-builder.js";
import type { PlanInput } from "./media-plan.js";
import type { InlineLink, SourcePoll } from "./bot-client.js";

/**
 * Pausa entre chunks de leitura. Leitura é barata comparada a publicação, mas
 * paginar um canal grande sem pausa nenhuma rende FLOOD_WAIT na conta.
 */
export const READ_THROTTLE_MS = 1000;

export class SourceReader {
  private peer: Api.TypeInputPeer;

  constructor(
    private client: MtprotoClient,
    private source: ClonePeer,
  ) {
    this.peer = buildHistoryPeer(source);
  }

  /**
   * Fonte para o iterHistoryAscending.
   *
   * ARMADILHA: NÃO passar waitTime — em requestIter.js:49-52 o gramjs entrega
   * o valor (documentado em segundos) para sleep(ms), então o throttle nativo
   * é ~1ms. O delay real é imposto pelo iterHistoryAscending.
   */
  historySource(): HistorySource {
    const client = this.client;
    const peer = this.peer;
    return {
      fetch: (sinceMsgId: number) =>
        client.raw.iterMessages(peer, {
          reverse: true,
          offsetId: sinceMsgId,
          limit: undefined,
        }) as AsyncIterable<unknown>,
      delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    };
  }

  get inputPeer(): Api.TypeInputPeer {
    return this.peer;
  }

  /** Título, descrição e foto da origem. Canal e grupo legacy usam calls diferentes. */
  async readIdentity(): Promise<SourceIdentity> {
    await this.client.connect();
    if (this.source.peerType === "chat") {
      const full = await this.client.raw.invoke(
        new Api.messages.GetFullChat({ chatId: bigInt(this.source.peerId) }),
      );
      const chat = full.chats.find((c): c is Api.Chat => c instanceof Api.Chat);
      return {
        title: chat?.title ?? "",
        about: (full.fullChat as Api.ChatFull).about ?? "",
        photo: await this.downloadIdentityPhoto(chat),
      };
    }
    const full = await this.client.raw.invoke(
      new Api.channels.GetFullChannel({
        channel: new Api.InputChannel({
          channelId: bigInt(this.source.peerId),
          accessHash: bigInt(this.source.accessHash ?? "0"),
        }),
      }),
    );
    const chan = full.chats.find((c): c is Api.Channel => c instanceof Api.Channel);
    return {
      title: chan?.title ?? "",
      about: (full.fullChat as Api.ChannelFull).about ?? "",
      photo: await this.downloadIdentityPhoto(chan),
    };
  }

  private async downloadIdentityPhoto(
    chat: Api.Chat | Api.Channel | undefined,
  ): Promise<Buffer | null> {
    if (!chat || !(chat.photo instanceof Api.ChatPhoto)) return null;
    try {
      const buf = await this.client.raw.downloadProfilePhoto(chat, { isBig: true });
      return Buffer.isBuffer(buf) && buf.length > 0 ? buf : null;
    } catch {
      // getInputPeer joga TypeError em canal `min` ou sem accessHash.
      return null;
    }
  }

  /**
   * "Proteger conteúdo" ligado na origem. Bloqueia encaminhamento (mas NÃO o
   * download), então decide a rota do clone.
   */
  async hasNoForwards(): Promise<boolean> {
    await this.client.connect();
    if (this.source.peerType === "chat") {
      // Api.Chat também carrega noforwards (api.d.ts:998 e :1020) — "proteger
      // conteúdo" não é exclusivo de canal, grupo legacy pode ter também. Não
      // reintroduzir o atalho `return false` daqui. Se a busca falhar ou não
      // achar o chat, assume protegido: errar nessa direção só deixa o clone
      // mais lento (rota de download); o contrário quebra em runtime com
      // CHAT_FORWARDS_RESTRICTED.
      try {
        const res = await this.client.raw.invoke(
          new Api.messages.GetChats({ id: [bigInt(this.source.peerId)] }),
        );
        const chats = res instanceof Api.messages.Chats ? res.chats : [];
        const chat = chats.find((c): c is Api.Chat => c instanceof Api.Chat);
        return chat ? Boolean(chat.noforwards) : true;
      } catch {
        return true;
      }
    }
    const res = await this.client.raw.invoke(
      new Api.channels.GetChannels({
        id: [
          new Api.InputChannel({
            channelId: bigInt(this.source.peerId),
            accessHash: bigInt(this.source.accessHash ?? "0"),
          }),
        ],
      }),
    );
    const chats = res instanceof Api.messages.Chats ? res.chats : [];
    const chan = chats[0];
    return chan instanceof Api.Channel ? Boolean(chan.noforwards) : false;
  }

  /** Ids das mensagens fixadas na origem. */
  async pinnedIds(): Promise<number[]> {
    await this.client.connect();
    const res = await this.client.raw.invoke(
      new Api.messages.Search({
        peer: this.peer,
        q: "",
        filter: new Api.InputMessagesFilterPinned(),
        minDate: 0,
        maxDate: 0,
        offsetId: 0,
        addOffset: 0,
        limit: 100,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      }),
    );
    const messages =
      res instanceof Api.messages.Messages ||
      res instanceof Api.messages.MessagesSlice ||
      res instanceof Api.messages.ChannelMessages
        ? res.messages
        : [];
    return messages.filter((m): m is Api.Message => m instanceof Api.Message).map((m) => m.id);
  }

  /**
   * Baixa a mídia da mensagem direto para disco (streaming, sem segurar o
   * arquivo em memória). Devolve null quando não há mídia ou o arquivo passa
   * do teto.
   */
  async downloadToPath(
    msg: Api.Message,
    dir: string,
    maxBytes: number,
  ): Promise<{ filePath: string; sizeBytes: number; fileName: string | null } | null> {
    if (!msg.media) return null;
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `msg_${msg.id}`);
    const out = createWriteStream(filePath);
    // Falha de escrita (ENOSPC, permissão) dispara o autoDestroy do
    // fs.WriteStream: 'error' e, poucos ms depois, 'close' (medido
    // empiricamente: ~5ms e ~7ms). Um listener de 'close' registrado só
    // depois do `for await` esgotar o download inteiro (como era antes,
    // dentro do finally) chega tarde demais — o 'close' já disparou e não
    // dispara de novo, então a promise nunca resolve nem rejeita e trava
    // pra sempre (pior que o crash que o listener de 'error' evitava, e o
    // loop ainda puxa o arquivo inteiro da rede à toa antes de travar).
    // Por isso o listener de 'close' abaixo só é registrado se o erro
    // ainda NÃO foi observado, e o loop de download corre em paralelo
    // (Promise.race) com uma promise que rejeita assim que 'error' dispara,
    // sem esperar o resto do arquivo ser puxado da rede.
    let streamError: Error | undefined;
    const errorPromise = new Promise<never>((_resolve, reject) => {
      out.on("error", (err) => {
        streamError = err;
        reject(err);
      });
    });
    try {
      try {
        // requestSize é obrigatório no .d.ts do gramjs mas opcional em runtime
        // (downloads.js:186 usa MAX_CHUNK_SIZE como default); repetimos o
        // mesmo valor aqui só para satisfazer o tipo, sem mudar o comportamento.
        const downloadLoop = (async () => {
          for await (const chunk of this.client.raw.iterDownload({
            file: msg.media as never,
            requestSize: 512 * 1024,
          })) {
            // Stream já destruída: escrever viraria no-op silencioso e
            // continuar puxando chunks da rede seria trabalho jogado fora.
            if (streamError) break;
            out.write(chunk);
          }
        })();
        await Promise.race([downloadLoop, errorPromise]);
      } finally {
        if (!streamError) {
          out.end();
          // WriteStream tipa o listener de "close" como () => void; o executor
          // da Promise expõe resolve com 1 parâmetro opcional, então empacota
          // numa arrow sem argumentos pra satisfazer o tipo do evento.
          await new Promise<void>((resolve) => out.on("close", () => resolve()));
        }
      }
      if (streamError) throw streamError;
    } catch (err) {
      // Download interrompido (queda de rede, FLOOD_WAIT,
      // FILE_REFERENCE_EXPIRED) ou falha de escrita: sem isso o arquivo
      // parcial `msg_<id>` fica órfão em disco pra sempre — clone histórico
      // longo bate nesse caminho com frequência real.
      await unlink(filePath).catch(() => {});
      throw err;
    }
    const { size } = await stat(filePath);
    if (size > maxBytes) {
      await unlink(filePath).catch(() => {});
      return null;
    }
    return { filePath, sizeBytes: size, fileName: SourceReader.originalFileName(msg) };
  }

  /** Encaminha um lote apagando a autoria. Chamado com no máximo 100 ids. */
  async forwardBatch(
    destChannelId: string,
    destAccessHash: string,
    ids: number[],
  ): Promise<Api.TypeUpdates> {
    return this.client.forwardBatch(
      this.peer,
      new Api.InputPeerChannel({
        channelId: bigInt(destChannelId),
        accessHash: bigInt(destAccessHash),
      }),
      ids,
    );
  }

  /**
   * Botões de URL da mensagem original. Callback não sobrevive à clonagem:
   * pertence ao bot que criou a mensagem.
   */
  static extractInlineLinks(msg: Api.Message): InlineLink[] {
    const markup = msg.replyMarkup;
    if (!(markup instanceof Api.ReplyInlineMarkup)) return [];
    const out: InlineLink[] = [];
    for (const row of markup.rows) {
      for (const btn of row.buttons) {
        if (btn instanceof Api.KeyboardButtonUrl) out.push({ label: btn.text, url: btn.url });
      }
    }
    return out;
  }

  /**
   * Nome original do arquivo (defeito I2): sem isso um documento reenviado
   * pelo bot vira `msg_<id>` sem extensão no destino. Só documento carrega
   * DocumentAttributeFilename; foto/vídeo sem esse atributo devolvem null e
   * o caller decide o fallback.
   */
  static originalFileName(msg: Api.Message): string | null {
    const media = msg.media;
    if (!(media instanceof Api.MessageMediaDocument)) return null;
    if (!(media.document instanceof Api.Document)) return null;
    const attr = media.document.attributes.find(
      (a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename,
    );
    return attr?.fileName ?? null;
  }

  /**
   * Lê a enquete original pra recriar via Bot API (defeito I7). Devolve null
   * quando a mídia não é enquete de verdade ou tem menos de 2 opções (a Bot
   * API exige 2-12) — defensivo: o publish-router só chama isso quando
   * planForMessage já classificou a mensagem como "poll".
   */
  static pollData(msg: Api.Message): SourcePoll | null {
    const media = msg.media;
    if (!(media instanceof Api.MessageMediaPoll)) return null;
    const poll = media.poll;
    const options = poll.answers.map((a) => a.text.text);
    if (options.length < 2) return null;
    return {
      question: poll.question.text,
      options,
      // publicVoters=true significa votos públicos, ou seja, NÃO anônima.
      isAnonymous: !poll.publicVoters,
      allowsMultipleAnswers: Boolean(poll.multipleChoice),
    };
  }

  /** Traduz a mensagem para a entrada do planForMessage. */
  static mediaPlanInput(msg: Api.Message, copyPolls: boolean): PlanInput {
    const media = msg.media ?? null;
    const attrs =
      media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document
        ? media.document.attributes.map((a) => a.className)
        : [];
    return {
      mediaClassName: media ? media.className : null,
      documentAttributeClassNames: attrs,
      hasText: Boolean(msg.message && msg.message.trim()),
      copyPolls,
    };
  }
}
