import type { CloneTopicMapRow, SourceTopic } from "./types.js";
export interface TopicSyncDeps {
    listSourceTopics(): Promise<SourceTopic[]>;
    createDestTopic(input: {
        title: string;
        iconColor: number;
        iconEmojiId: string | null;
    }): Promise<number>;
    setClosed(destTopicId: number, closed: boolean): Promise<void>;
    setPinned(destTopicId: number, pinned: boolean): Promise<void>;
    loadExisting(jobId: string): Promise<CloneTopicMapRow[]>;
    persist(jobId: string, row: CloneTopicMapRow): Promise<void>;
}
export interface SyncTopicsResult {
    /** Pré-semeado com 1->1 (General nunca é recriado). */
    topicMap: Map<number, number>;
    /** Reaproveitado por finalizeTopics — evita um 2º fetch de GetForumTopics. */
    sourceTopics: SourceTopic[];
}
/**
 * Cria no destino os tópicos que faltam e devolve o mapa origem->destino.
 * Idempotente na retomada: tópicos já 'copied' não são recriados. Tópicos
 * 'failed' SÃO retentados a cada resume — diferente do resume de mensagem
 * (que nunca revisita uma linha 'failed'): a lista de tópicos é pequena e
 * barata de re-escanear por completo toda vez, sem a pressão de perf que
 * justifica o modelo "nunca olha pra trás" do cursor de mensagens.
 *
 * Falha de UM tópico não aborta os demais — fica 'failed', suas mensagens
 * caem em General via fallback do publish-router (perder o agrupamento por
 * tópico é melhor que perder a mensagem ou o job inteiro). FLOOD_WAIT é a
 * exceção: precisa subir pro catch de setup do clone-handler (que já sabe
 * agendar retomada), não virar um 'failed' permanente por um erro transitório.
 */
export declare function syncTopics(deps: TopicSyncDeps, input: {
    jobId: string;
}): Promise<SyncTopicsResult>;
/**
 * Segunda passada: fecha/fixa tópicos — só deve ser chamada depois que o job
 * atinge status='completed' de verdade (nunca em pausa/flood/falha). Fechar
 * um tópico logo na criação, antes do loop principal (passe único ascendente
 * sobre o histórico inteiro) ter publicado todas as mensagens daquele tópico
 * — que podem vir bem depois no stream — arriscaria o bot não conseguir mais
 * postar nele; não verificável nesse ambiente sandboxed, então adiar custa
 * zero e remove a dependência dessa suposição. Best-effort por tópico, mesmo
 * padrão do pinInDest em clone-handler.ts: uma falha aqui não reabre o job
 * nem marca nada como failed.
 */
export declare function finalizeTopics(deps: Pick<TopicSyncDeps, "setClosed" | "setPinned">, topicMap: Map<number, number>, sourceTopics: SourceTopic[]): Promise<void>;
