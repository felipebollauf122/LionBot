import type { NodeContext, NodeResult } from "../types.js";
/**
 * Nó gerado só pela clonagem de fluxo de bot (server/src/services/mtproto/
 * bot-clone/transcript-to-flow.ts) — representa conteúdo que não deu pra
 * mapear automaticamente pro vocabulário de nós do EagleBot: botão pulado
 * pelo payment-guard ("skipped_branch"), botão nunca clicado até o job
 * terminar ("not_explored"), ou mídia de tipo não suportado pelo engine
 * ("unsupported_media"). Nunca aparece na paleta de "arrastar novo nó" do
 * editor — só existe como saída de um fluxo clonado, pra revisão manual
 * antes de ativar (fluxos clonados sempre entram com is_active=false).
 */
export declare function handleUnmappedNode(ctx: NodeContext): Promise<NodeResult>;
