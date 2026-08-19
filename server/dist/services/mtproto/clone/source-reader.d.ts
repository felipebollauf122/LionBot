import { Api } from "telegram";
import type { MtprotoClient } from "../client.js";
import type { HistorySource } from "./history-iterator.js";
import type { ClonePeer, SourceTopic } from "./types.js";
import type { SourceIdentity } from "./dest-builder.js";
import type { PlanInput } from "./media-plan.js";
import type { InlineLink, SourcePoll } from "./bot-client.js";
/**
 * Pausa entre chunks de leitura. Leitura é barata comparada a publicação, mas
 * paginar um canal grande sem pausa nenhuma rende FLOOD_WAIT na conta.
 */
export declare const READ_THROTTLE_MS = 1000;
export declare class SourceReader {
    private client;
    private source;
    private peer;
    constructor(client: MtprotoClient, source: ClonePeer);
    /**
     * Fonte para o iterHistoryAscending.
     *
     * ARMADILHA: NÃO passar waitTime — em requestIter.js:49-52 o gramjs entrega
     * o valor (documentado em segundos) para sleep(ms), então o throttle nativo
     * é ~1ms. O delay real é imposto pelo iterHistoryAscending.
     */
    historySource(): HistorySource;
    get inputPeer(): Api.TypeInputPeer;
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
    floorForLastN(limit: number): Promise<number>;
    /** Título, descrição e foto da origem. Canal e grupo legacy usam calls diferentes. */
    readIdentity(): Promise<SourceIdentity>;
    private downloadIdentityPhoto;
    /**
     * A origem é um supergrupo com Topics ligado? Grupo legacy (peerType
     * "chat") nunca é fórum — Telegram só permite Topics em supergrupo.
     * Round-trip separado de hasNoForwards(): são preocupações ortogonais
     * (proteção de conteúdo decide estratégia; fórum decide tópicos), e
     * juntar os dois alargaria o retorno de uma função já usada em produção
     * sem ganho real.
     */
    isForum(): Promise<boolean>;
    /** Tópicos de fórum da origem, normalizados. Grupo legacy: lista vazia. */
    listTopics(): Promise<SourceTopic[]>;
    /**
     * "Proteger conteúdo" ligado na origem. Bloqueia encaminhamento (mas NÃO o
     * download), então decide a rota do clone.
     */
    hasNoForwards(): Promise<boolean>;
    /** Ids das mensagens fixadas na origem. */
    pinnedIds(): Promise<number[]>;
    /**
     * Baixa a mídia da mensagem direto para disco (streaming, sem segurar o
     * arquivo em memória). Devolve null quando não há mídia ou o arquivo passa
     * do teto.
     */
    downloadToPath(msg: Api.Message, dir: string, maxBytes: number): Promise<{
        filePath: string;
        sizeBytes: number;
        fileName: string | null;
    } | null>;
    /**
     * Encaminha um lote apagando a autoria. Chamado com no máximo 100 ids.
     * `topMsgId` ancora o lote no tópico de fórum correspondente do destino.
     */
    forwardBatch(destChannelId: string, destAccessHash: string, ids: number[], topMsgId?: number): Promise<Api.TypeUpdates>;
    /**
     * Botões de URL da mensagem original. Callback não sobrevive à clonagem:
     * pertence ao bot que criou a mensagem.
     */
    static extractInlineLinks(msg: Api.Message): InlineLink[];
    /**
     * Nome original do arquivo (defeito I2): sem isso um documento reenviado
     * pelo bot vira `msg_<id>` sem extensão no destino. Só documento carrega
     * DocumentAttributeFilename; foto/vídeo sem esse atributo devolvem null e
     * o caller decide o fallback.
     */
    static originalFileName(msg: Api.Message): string | null;
    /**
     * Lê a enquete original pra recriar via Bot API (defeito I7). Devolve null
     * quando a mídia não é enquete de verdade ou tem menos de 2 opções (a Bot
     * API exige 2-12) — defensivo: o publish-router só chama isso quando
     * planForMessage já classificou a mensagem como "poll".
     */
    static pollData(msg: Api.Message): SourcePoll | null;
    /** Traduz a mensagem para a entrada do planForMessage. */
    static mediaPlanInput(msg: Api.Message, copyPolls: boolean): PlanInput;
}
