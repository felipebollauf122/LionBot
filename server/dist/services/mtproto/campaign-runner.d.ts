import type { AccountPool } from "./pool.js";
export interface CampaignTargetRow {
    id: string;
    identifier: string;
    type: "username" | "phone";
    status: "pending" | "sent" | "failed";
    /**
     * Quando setado, o runner ignora identifier/type e envia direto pro peer
     * via sendMessageToPeer do MtprotoClient (mais barato e seguro — não tenta
     * resolveUsername nem importContacts).
     */
    dialog?: {
        peerId: string;
        peerType: "user" | "chat" | "channel";
        peerAccessHash: string | null;
    };
    /**
     * Quando setado, força essa conta específica a enviar (ignora round-robin
     * do pool). Usado em campanhas globais — cada target já vem com a conta
     * dona do dialog. Se a conta estiver indisponível (flood_wait/banned), o
     * target é pulado naquele tick e retentado depois.
     */
    pinnedAccountId?: string;
}
export interface RunnerDeps {
    sendMessage: (accountId: string, target: CampaignTargetRow, text: string) => Promise<void>;
    markTargetSent: (targetId: string, accountId: string) => Promise<void>;
    markTargetFailed: (targetId: string, accountId: string | null, error: string) => Promise<void>;
    /**
     * Marca um target pinned pra retry depois de FLOOD_WAIT (#47): mantém
     * status='pending' mas seta retry_after, pra não perder o lead. Se a dep
     * não for fornecida, cai no markTargetFailed (comportamento antigo).
     */
    markTargetRetryAfter?: (targetId: string, retryAfterIso: string) => Promise<void>;
    incrementCounters: (campaignId: string, kind: "sent" | "failed") => Promise<void>;
    setCampaignStatus: (campaignId: string, status: "running" | "paused" | "completed" | "failed") => Promise<void>;
    /**
     * Lê status atual da campanha no DB. Runner usa pra abortar mid-loop
     * caso o usuário pause manualmente pela UI.
     */
    getCampaignStatus: (campaignId: string) => Promise<string | null>;
    /**
     * Re-busca targets pending no DB. Usado quando o runner termina o
     * snapshot atual — se contas novas foram adicionadas à campanha global
     * enquanto o runner rodava, esses targets recém-inseridos aparecem aqui
     * e o runner continua processando sem precisar enfileirar novo job.
     */
    refetchPending?: (campaignId: string) => Promise<CampaignTargetRow[]>;
    /**
     * Recarrega contas no pool. Quando uma conta nova é conectada no meio
     * de uma campanha global, ela vira disponível pra enviar os próprios
     * targets pinned.
     */
    reloadPool?: () => Promise<void>;
    /**
     * Marca a conta como banida/inválida no DB (status='banned' + last_error).
     * Chamado quando o Telegram retorna AUTH_KEY_UNREGISTERED, USER_DEACTIVATED,
     * SESSION_REVOKED ou PHONE_NUMBER_BANNED. Próximas campanhas pulam essa
     * conta automaticamente até o owner relogar pelo bot/dashboard.
     */
    markAccountFatal?: (accountId: string, error: string) => Promise<void>;
    delay: (ms: number) => Promise<void>;
}
export interface CampaignConfig {
    campaignId: string;
    messageText: string;
    delayMinSeconds: number;
    delayMaxSeconds: number;
}
export declare class CampaignRunner {
    private pool;
    private deps;
    private cfg;
    constructor(pool: AccountPool, deps: RunnerDeps, cfg: CampaignConfig);
    run(targets: CampaignTargetRow[]): Promise<void>;
    private processBatch;
}
