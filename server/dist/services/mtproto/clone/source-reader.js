import { Api } from "telegram";
import bigInt from "big-integer";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { downloadMediaToPath } from "../download-media.js";
import { buildHistoryPeer } from "./history-iterator.js";
/**
 * Pausa entre chunks de leitura. Leitura é barata comparada a publicação, mas
 * paginar um canal grande sem pausa nenhuma rende FLOOD_WAIT na conta.
 */
export const READ_THROTTLE_MS = 1000;
export class SourceReader {
    client;
    source;
    peer;
    constructor(client, source) {
        this.client = client;
        this.source = source;
        this.peer = buildHistoryPeer(source);
    }
    /**
     * Fonte para o iterHistoryAscending.
     *
     * ARMADILHA: NÃO passar waitTime — em requestIter.js:49-52 o gramjs entrega
     * o valor (documentado em segundos) para sleep(ms), então o throttle nativo
     * é ~1ms. O delay real é imposto pelo iterHistoryAscending.
     */
    historySource() {
        const client = this.client;
        const peer = this.peer;
        return {
            fetch: (sinceMsgId) => client.raw.iterMessages(peer, {
                reverse: true,
                offsetId: sinceMsgId,
                limit: undefined,
            }),
            delay: (ms) => new Promise((r) => setTimeout(r, ms)),
        };
    }
    get inputPeer() {
        return this.peer;
    }
    /**
     * Menor id entre as N mensagens reais (Api.Message, sem contar serviço)
     * mais recentes da origem. Defeito I8: "últimas N mensagens" tem que ser
     * as N mais NOVAS, não as N mais antigas — mas o runner só sabe iterar em
     * ordem ascendente (do mais antigo pro mais novo), pra manter a retomada
     * pelo cursor. A solução é dar um PISO pra essa iteração ascendente: busca
     * as N mais recentes (ordem padrão do Telegram, mais novo primeiro), pega
     * o menor id entre elas, e usa como offsetId — a iteração ascendente
     * continua funcionando do jeito que sempre funcionou, só que começando
     * perto do fim do histórico em vez do início. Composição com o cursor
     * feita no caller (clone-handler): Math.max(cursorPersistido, piso - 1).
     *
     * Devolve 0 (sem piso = clona desde o início) quando o canal tem N
     * mensagens reais ou menos.
     */
    async floorForLastN(limit) {
        if (!limit || limit <= 0)
            return 0;
        await this.client.connect();
        let minId = 0;
        let count = 0;
        for await (const raw of this.client.raw.iterMessages(this.peer, {
            limit: undefined,
        })) {
            if (!(raw instanceof Api.Message))
                continue;
            if (minId === 0 || raw.id < minId)
                minId = raw.id;
            count++;
            if (count >= limit)
                break;
        }
        return count >= limit ? minId : 0;
    }
    /** Título, descrição e foto da origem. Canal e grupo legacy usam calls diferentes. */
    async readIdentity() {
        await this.client.connect();
        if (this.source.peerType === "chat") {
            const full = await this.client.raw.invoke(new Api.messages.GetFullChat({ chatId: bigInt(this.source.peerId) }));
            const chat = full.chats.find((c) => c instanceof Api.Chat);
            return {
                title: chat?.title ?? "",
                about: full.fullChat.about ?? "",
                photo: await this.downloadIdentityPhoto(chat),
            };
        }
        const full = await this.client.raw.invoke(new Api.channels.GetFullChannel({
            channel: new Api.InputChannel({
                channelId: bigInt(this.source.peerId),
                accessHash: bigInt(this.source.accessHash ?? "0"),
            }),
        }));
        const chan = full.chats.find((c) => c instanceof Api.Channel);
        return {
            title: chan?.title ?? "",
            about: full.fullChat.about ?? "",
            photo: await this.downloadIdentityPhoto(chan),
        };
    }
    async downloadIdentityPhoto(chat) {
        if (!chat || !(chat.photo instanceof Api.ChatPhoto))
            return null;
        try {
            const buf = await this.client.raw.downloadProfilePhoto(chat, { isBig: true });
            return Buffer.isBuffer(buf) && buf.length > 0 ? buf : null;
        }
        catch {
            // getInputPeer joga TypeError em canal `min` ou sem accessHash.
            return null;
        }
    }
    /**
     * A origem é um supergrupo com Topics ligado? Grupo legacy (peerType
     * "chat") nunca é fórum — Telegram só permite Topics em supergrupo.
     * Round-trip separado de hasNoForwards(): são preocupações ortogonais
     * (proteção de conteúdo decide estratégia; fórum decide tópicos), e
     * juntar os dois alargaria o retorno de uma função já usada em produção
     * sem ganho real.
     */
    async isForum() {
        if (this.source.peerType === "chat")
            return false;
        await this.client.connect();
        const res = await this.client.raw.invoke(new Api.channels.GetChannels({
            id: [
                new Api.InputChannel({
                    channelId: bigInt(this.source.peerId),
                    accessHash: bigInt(this.source.accessHash ?? "0"),
                }),
            ],
        }));
        const chats = res instanceof Api.messages.Chats ? res.chats : [];
        const chan = chats[0];
        return chan instanceof Api.Channel ? Boolean(chan.forum) : false;
    }
    /** Tópicos de fórum da origem, normalizados. Grupo legacy: lista vazia. */
    async listTopics() {
        if (this.source.peerType === "chat")
            return [];
        await this.client.connect();
        const topics = await this.client.listForumTopics(this.source.peerId, this.source.accessHash ?? "0");
        return topics.map((t) => ({
            id: t.id,
            title: t.title,
            iconColor: t.iconColor,
            iconEmojiId: t.iconEmojiId ? t.iconEmojiId.toString() : null,
            closed: Boolean(t.closed),
            pinned: Boolean(t.pinned),
        }));
    }
    /**
     * "Proteger conteúdo" ligado na origem. Bloqueia encaminhamento (mas NÃO o
     * download), então decide a rota do clone.
     */
    async hasNoForwards() {
        await this.client.connect();
        if (this.source.peerType === "chat") {
            // Api.Chat também carrega noforwards (api.d.ts:998 e :1020) — "proteger
            // conteúdo" não é exclusivo de canal, grupo legacy pode ter também. Não
            // reintroduzir o atalho `return false` daqui. Se a busca falhar ou não
            // achar o chat, assume protegido: errar nessa direção só deixa o clone
            // mais lento (rota de download); o contrário quebra em runtime com
            // CHAT_FORWARDS_RESTRICTED.
            try {
                const res = await this.client.raw.invoke(new Api.messages.GetChats({ id: [bigInt(this.source.peerId)] }));
                const chats = res instanceof Api.messages.Chats ? res.chats : [];
                const chat = chats.find((c) => c instanceof Api.Chat);
                return chat ? Boolean(chat.noforwards) : true;
            }
            catch {
                return true;
            }
        }
        const res = await this.client.raw.invoke(new Api.channels.GetChannels({
            id: [
                new Api.InputChannel({
                    channelId: bigInt(this.source.peerId),
                    accessHash: bigInt(this.source.accessHash ?? "0"),
                }),
            ],
        }));
        const chats = res instanceof Api.messages.Chats ? res.chats : [];
        const chan = chats[0];
        return chan instanceof Api.Channel ? Boolean(chan.noforwards) : false;
    }
    /** Ids das mensagens fixadas na origem. */
    async pinnedIds() {
        await this.client.connect();
        const res = await this.client.raw.invoke(new Api.messages.Search({
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
        }));
        const messages = res instanceof Api.messages.Messages ||
            res instanceof Api.messages.MessagesSlice ||
            res instanceof Api.messages.ChannelMessages
            ? res.messages
            : [];
        return messages.filter((m) => m instanceof Api.Message).map((m) => m.id);
    }
    /**
     * Baixa a mídia da mensagem direto para disco (streaming, sem segurar o
     * arquivo em memória). Devolve null quando não há mídia ou o arquivo passa
     * do teto.
     */
    async downloadToPath(msg, dir, maxBytes) {
        if (!msg.media)
            return null;
        await mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `msg_${msg.id}`);
        // Núcleo de streaming (defesa de timing 'error'/'close', cleanup de
        // arquivo parcial em falha) mora em download-media.ts — reaproveitado
        // também pelo bot-flow-clone (media-rehost.ts), sem duplicar essa
        // lógica frágil em dois lugares.
        const size = await downloadMediaToPath(this.client.raw, msg.media, filePath, maxBytes);
        if (size === null)
            return null;
        return { filePath, sizeBytes: size, fileName: SourceReader.originalFileName(msg) };
    }
    /**
     * Encaminha um lote apagando a autoria. Chamado com no máximo 100 ids.
     * `topMsgId` ancora o lote no tópico de fórum correspondente do destino.
     */
    async forwardBatch(destChannelId, destAccessHash, ids, topMsgId) {
        return this.client.forwardBatch(this.peer, new Api.InputPeerChannel({
            channelId: bigInt(destChannelId),
            accessHash: bigInt(destAccessHash),
        }), ids, topMsgId);
    }
    /**
     * Botões de URL da mensagem original. Callback não sobrevive à clonagem:
     * pertence ao bot que criou a mensagem.
     */
    static extractInlineLinks(msg) {
        const markup = msg.replyMarkup;
        if (!(markup instanceof Api.ReplyInlineMarkup))
            return [];
        const out = [];
        for (const row of markup.rows) {
            for (const btn of row.buttons) {
                if (btn instanceof Api.KeyboardButtonUrl)
                    out.push({ label: btn.text, url: btn.url });
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
    static originalFileName(msg) {
        const media = msg.media;
        if (!(media instanceof Api.MessageMediaDocument))
            return null;
        if (!(media.document instanceof Api.Document))
            return null;
        const attr = media.document.attributes.find((a) => a instanceof Api.DocumentAttributeFilename);
        return attr?.fileName ?? null;
    }
    /**
     * Lê a enquete original pra recriar via Bot API (defeito I7). Devolve null
     * quando a mídia não é enquete de verdade ou tem menos de 2 opções (a Bot
     * API exige 2-12) — defensivo: o publish-router só chama isso quando
     * planForMessage já classificou a mensagem como "poll".
     */
    static pollData(msg) {
        const media = msg.media;
        if (!(media instanceof Api.MessageMediaPoll))
            return null;
        const poll = media.poll;
        const options = poll.answers.map((a) => a.text.text);
        if (options.length < 2)
            return null;
        return {
            question: poll.question.text,
            options,
            // publicVoters=true significa votos públicos, ou seja, NÃO anônima.
            isAnonymous: !poll.publicVoters,
            allowsMultipleAnswers: Boolean(poll.multipleChoice),
        };
    }
    /** Traduz a mensagem para a entrada do planForMessage. */
    static mediaPlanInput(msg, copyPolls) {
        const media = msg.media ?? null;
        const attrs = media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document
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
