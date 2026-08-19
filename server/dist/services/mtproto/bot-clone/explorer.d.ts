import type { Api } from "telegram";
import type { ButtonKind } from "./payment-guard.js";
import type { CapturedEntity } from "./entities-to-html.js";
export type NodeStatus = "explored" | "duplicate" | "skipped_error";
export interface PersistedButton {
    id: string;
    kind: ButtonKind;
    label: string;
    url: string | null;
    /** base64 do callback data — só presente pra kind="callback". */
    data: string | null;
    skip: boolean;
    skipReason: string | null;
    paymentDomainMatch: boolean;
}
export interface PersistedMessage {
    seq: number;
    rawMsgId: number;
    text: string | null;
    entities: CapturedEntity[];
    mediaKind: string;
    mediaPublicUrl: string | null;
    buttons: PersistedButton[];
}
/**
 * Mensagem crua de um burst — como o deps.captureBurst() real (implementado
 * em bot-clone-handler.ts a partir de Api.Message vivos) devolve. `media` só
 * é usado internamente pro rehost, nunca persistido como está.
 */
export interface RawCapturedMessage {
    rawMsgId: number;
    text: string | null;
    entities: Api.TypeMessageEntity[] | undefined;
    mediaKind: string;
    media: unknown;
    fileName: string | null;
    rawButtons: Api.TypeKeyboardButton[];
}
export interface ExistingNode {
    id: string;
    fingerprint: string;
    status: NodeStatus;
    parentNodeId: string | null;
    triggeredByButtonId: string | null;
    depth: number;
    messages: PersistedMessage[];
}
export interface PersistNodeInput {
    parentNodeId: string | null;
    triggeredByButtonId: string | null;
    depth: number;
    fingerprint: string;
    duplicateOfNodeId: string | null;
    messages: PersistedMessage[];
    status: NodeStatus;
    paymentConfirmationSuspected: boolean;
}
export interface BotExplorerDeps {
    sendStart(): Promise<void>;
    clickButton(msgId: number, data: Buffer): Promise<void>;
    /** Espera e junta as próximas mensagens do bot-alvo num burst — a janela de silêncio/teto já é resolvida por quem implementa. */
    captureBurst(): Promise<RawCapturedMessage[]>;
    /** Baixa e re-hospeda mídia — URL pública, ou null se não há mídia/passa do teto. */
    rehostMedia(media: unknown, nodeIdHint: string, fileName: string): Promise<string | null>;
    loadExistingNodes(): Promise<ExistingNode[]>;
    persistNode(row: PersistNodeInput): Promise<string>;
    getStatus(): Promise<string | null>;
    delay(ms: number): Promise<void>;
}
export interface BotExplorerConfig {
    maxDepth: number;
    maxNodes: number;
    clickThrottleMs: number;
}
/**
 * Percorre a árvore de conversa de um bot-alvo via BFS: /start, captura o
 * burst de resposta, classifica cada botão (payment-guard.ts) e clica só os
 * elegíveis, um de cada vez. Injeção de dependência igual CloneRunner —
 * toda I/O real (client MTProto, Supabase) fica de fora, aqui só a
 * orquestração/decisão, testável com deps falsos.
 */
export declare class BotExplorer {
    private deps;
    private cfg;
    private byFingerprint;
    private byParentButton;
    private exploredCount;
    private rootExists;
    constructor(deps: BotExplorerDeps, cfg: BotExplorerConfig);
    run(): Promise<void>;
    private parentButtonKey;
    private shouldStop;
    /** Executa a ação (start ou clique), captura o burst, fingerprinta e persiste. Devolve os próximos itens candidatos (não filtrados por teto — isso acontece no run()). */
    private processItem;
    /** Classifica botões, baixa/re-hospeda mídia — só roda pra burst que NÃO é duplicata. */
    private materializeMessages;
}
