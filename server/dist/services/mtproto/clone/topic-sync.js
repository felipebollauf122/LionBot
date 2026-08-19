import { extractWaitSeconds } from "../flood.js";
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
export async function syncTopics(deps, input) {
    const topicMap = new Map([[1, 1]]);
    const existing = await deps.loadExisting(input.jobId);
    for (const row of existing) {
        if (row.status === "copied" && row.destTopicId !== null) {
            topicMap.set(row.sourceTopicId, row.destTopicId);
        }
    }
    const sourceTopics = await deps.listSourceTopics();
    for (const topic of sourceTopics) {
        if (topic.id === 1)
            continue; // General: nunca recriado
        if (topicMap.has(topic.id))
            continue; // já copiado numa execução anterior
        try {
            const destTopicId = await deps.createDestTopic({
                title: topic.title,
                iconColor: topic.iconColor,
                iconEmojiId: topic.iconEmojiId,
            });
            topicMap.set(topic.id, destTopicId);
            await deps.persist(input.jobId, {
                sourceTopicId: topic.id,
                destTopicId,
                title: topic.title,
                status: "copied",
                reason: null,
            });
        }
        catch (err) {
            if (extractWaitSeconds(err) !== null)
                throw err; // flood sobe pro setup do clone-handler
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`[clone.topics] falha ao criar tópico "${topic.title}" (${topic.id}):`, err);
            await deps.persist(input.jobId, {
                sourceTopicId: topic.id,
                destTopicId: null,
                title: topic.title,
                status: "failed",
                reason,
            });
        }
    }
    return { topicMap, sourceTopics };
}
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
export async function finalizeTopics(deps, topicMap, sourceTopics) {
    for (const topic of sourceTopics) {
        const destTopicId = topicMap.get(topic.id);
        if (destTopicId === undefined || topic.id === 1)
            continue; // não criado, ou é o General
        if (topic.closed) {
            await deps
                .setClosed(destTopicId, true)
                .catch((err) => console.warn(`[clone.topics] setClosed falhou (tópico ${topic.id}):`, err));
        }
        if (topic.pinned) {
            await deps
                .setPinned(destTopicId, true)
                .catch((err) => console.warn(`[clone.topics] setPinned falhou (tópico ${topic.id}):`, err));
        }
    }
}
