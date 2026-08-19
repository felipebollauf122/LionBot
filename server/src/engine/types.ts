import type { TelegramApi } from "../telegram/api.js";

export interface FlowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface Lead {
  id: string;
  tenant_id: string;
  bot_id: string;
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  tid: string | null;
  fbclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  current_flow_id: string | null;
  current_node_id: string | null;
  active_flow_name: string | null;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NodeContext {
  node: FlowNode;
  lead: Lead;
  edges: FlowEdge[];
  telegram: TelegramApi;
  chatId: number;
  /** Biblioteca de mídia pré-carregada uma vez por executeFlow (evita N+1
   * round-trip por nó) — só presente quando algum nó image/video do flow usa
   * randomize=true. Chave = media_assets.id. */
  mediaAssets?: Map<string, { url: string; kind: "image" | "video" }>;
  /** remarketing_flows.id quando este ctx pertence a uma execução de
   * remarketing (persistPosition=false em executeFlow), null caso contrário. */
  remarketingFlowId?: string | null;
}

export interface NodeResult {
  nextNodeId: string | null;
  stateUpdates?: Record<string, unknown>;
  delaySeconds?: number;
  /** Message IDs sent by this node (used by black flow for auto-deletion) */
  messageIds?: number[];
  /** True when the user has blocked the bot — flow should stop and lead should be flagged */
  blocked?: boolean;
  /** Qual mídia/texto/preço este nó escolheu neste envio (randomizado ou
   * fixo) — acumulado por executeFlow numa linha de remarketing_variant_sends. */
  variantChoice?: {
    mediaAssetId?: string | null;
    textVariantIndex?: number | null;
    bundleId?: string | null;
  };
}

export type NodeHandler = (ctx: NodeContext) => Promise<NodeResult>;
