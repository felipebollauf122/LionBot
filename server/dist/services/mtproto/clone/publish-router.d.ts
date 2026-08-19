import { Api } from "telegram";
import type { MediaPlan } from "./media-plan.js";
import { SourceReader } from "./source-reader.js";
import type { CompanionBot } from "./bot-client.js";
import type { LinkReplaceDeps, LinkReplaceValues } from "./link-replace.js";
import type { CloneOutcome, CloneStrategy, SourceMessage } from "./types.js";
export declare function chooseStrategy(input: {
    requested: "auto" | "batch" | "download";
    sourceHasNoForwards: boolean;
    copyButtons: boolean;
    /**
     * Defeito I5: opcional com default false pra não quebrar o build enquanto
     * o call site em clone-handler.ts ainda não passa esse campo (ver nota no
     * relatório da task — o outro agente precisa somar `copyReplies:
     * job.copy_replies` na chamada de lá).
     */
    copyReplies?: boolean;
    /**
     * Clone cross-account: a conta que lê a origem é diferente da que cria o
     * destino. O ForwardMessages encaminha de um chat pro outro DENTRO da mesma
     * sessão — com contas diferentes ninguém está nos dois lados, então a rota
     * lote é impossível. Opcional com default false (mesma conta = comportamento
     * atual).
     */
    crossAccount?: boolean;
    /**
     * Troca de link (bot/grupo/canal) configurada. O ForwardMessages copia o
     * conteúdo server-side — o app nunca vê raw.message/raw.entities/botões
     * nessa rota, então trocar link ali dentro é impossível. Mesma razão de
     * copyButtons acima.
     */
    linkReplaceConfigured?: boolean;
}): CloneStrategy;
export type RouteDecision = {
    mode: "forward";
    skipIndexes?: number[];
} | {
    mode: "album";
} | {
    mode: "single";
} | {
    mode: "skip_all";
};
export interface RouteInput {
    strategy: CloneStrategy;
    plans: MediaPlan[];
    copyPolls: boolean;
    copyButtons: boolean;
}
export declare function routeGroup(input: RouteInput): RouteDecision;
/** Teto por arquivo. Acima disso a mensagem é pulada com reason file_too_large. */
export declare const MAX_FILE_BYTES: number;
export interface PublisherContext {
    reader: SourceReader;
    bot: CompanionBot;
    destChannelId: string;
    destAccessHash: string;
    strategy: CloneStrategy;
    copyPolls: boolean;
    copyButtons: boolean;
    tmpDir: string;
    /** Mapa origem->destino de tópicos de fórum. null = job sem fórum (comportamento de sempre). */
    topicMap: Map<number, number> | null;
    /** Troca de link por categoria. null = job sem a feature (comportamento de sempre). */
    linkReplace: {
        classify: LinkReplaceDeps["classify"];
        values: LinkReplaceValues;
    } | null;
}
/**
 * Devolve a função `publish` que o CloneRunner injeta. Toda a decisão já foi
 * tomada por chooseStrategy/routeGroup; aqui é só execução.
 */
export declare function createPublisher(ctx: PublisherContext): (group: SourceMessage[], replyToDestId: number | null) => Promise<CloneOutcome[]>;
/** Colhe os ids criados no destino a partir do Updates do ForwardMessages. */
export declare function extractNewMessageIds(updates: Api.TypeUpdates): number[];
