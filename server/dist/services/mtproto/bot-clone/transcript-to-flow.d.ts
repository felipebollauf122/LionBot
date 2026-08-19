import type { FlowNode, FlowEdge } from "../../../engine/types.js";
import type { PersistedMessage } from "./explorer.js";
export interface FlowData {
    nodes: FlowNode[];
    edges: FlowEdge[];
}
export interface CapturedNodeForFlow {
    id: string;
    parentNodeId: string | null;
    triggeredByButtonId: string | null;
    status: "explored" | "duplicate" | "skipped_error";
    duplicateOfNodeId: string | null;
    messages: PersistedMessage[];
}
/**
 * Reconstrói o grafo de fluxo a partir dos turnos capturados. DUAS
 * PASSADAS (achado #6 da revisão adversarial): a passada 1 monta e atribui
 * o id de TODO turno primeiro; só a passada 2 emite as arestas entre
 * turnos (incluindo back-edges de duplicata/loop) — nunca aponta pra um id
 * que ainda não foi atribuído, o que uma reconstrução de passe único não
 * garante quando a ordem de visita não é cronológica.
 */
export declare function buildFlowGraph(nodes: CapturedNodeForFlow[], priceMap?: Map<string, string>): FlowData;
