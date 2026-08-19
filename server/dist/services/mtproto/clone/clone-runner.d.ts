import type { CloneJobConfig, CloneMapRow, CloneOutcome, CloneStatus, SourceMessage } from "./types.js";
export interface CloneStatusPatch {
    copiedCount?: number;
    skippedCount?: number;
    failedCount?: number;
    totalSeen?: number;
    lastError?: string | null;
}
export interface CloneRunnerDeps {
    /** Mensagens da origem em ordem crescente, começando depois de sinceMsgId. */
    iterate(sinceMsgId: number): AsyncIterable<SourceMessage>;
    /** Publica um grupo (1 mensagem, ou um álbum já fatiado) no destino. */
    publish(group: SourceMessage[], replyToDestId: number | null): Promise<CloneOutcome[]>;
    persist(jobId: string, rows: CloneMapRow[], cursor: number): Promise<void>;
    loadIdMap(jobId: string): Promise<Array<[number, number]>>;
    /**
     * Contadores ja persistidos deste job. O runner e reconstruido do zero a
     * cada retomada, entao sem isso o progresso volta pra tras e o messageLimit
     * recomeca a contar (job com limite 500 que ja copiou 400 copiaria mais 500).
     */
    loadCounters(jobId: string): Promise<{
        copied: number;
        skipped: number;
        failed: number;
        seen: number;
    }>;
    getStatus(jobId: string): Promise<string | null>;
    setStatus(jobId: string, status: CloneStatus, patch: CloneStatusPatch): Promise<void>;
    /**
     * Defeito I3: heartbeat de progresso. setStatus só grava contadores nas
     * transições terminais (running com patch vazio, waiting_flood, completed,
     * failed) e persist() só grava o cursor — então a barra de progresso lida
     * via polling (copied_count/skipped_count/failed_count/total_seen) fica
     * travada em 0% a run inteira e pula pra 100% no fim. Chamado ao fim de
     * cada flush() com os contadores atuais; a implementação real escreve
     * só essas 4 colunas (nunca status/started_at).
     */
    heartbeat(jobId: string, counters: CloneStatusPatch): Promise<void>;
    scheduleResume(jobId: string, seconds: number): Promise<void>;
    sourcePinnedIds(): Promise<number[]>;
    pinInDest(destMsgIds: number[]): Promise<void>;
    delay(ms: number): Promise<void>;
}
export declare class CloneRunner {
    private deps;
    private cfg;
    private idMap;
    private copied;
    private skipped;
    private failed;
    private seen;
    constructor(deps: CloneRunnerDeps, cfg: CloneJobConfig);
    run(): Promise<void>;
    /** Publica um grupo, grava o resultado e avança o cursor. */
    private flush;
    /**
     * Resposta só é remapeada se o alvo já foi clonado. Alvo fora do
     * messageLimit vira envio sem resposta — perder o encadeamento é melhor
     * que perder a mensagem.
     */
    private resolveReply;
    private applyPins;
    private shouldStop;
    private limitReached;
    private highestCopiedSource;
    private counters;
}
