import type { CSSProperties } from "react";

/**
 * Fonte única de identidade visual e regras dos blocos do editor de fluxo.
 * Regra de cor: 1 cor = 1 significado.
 *   - Início (trigger) ............ --accent
 *   - Mensagens (text/image/video/audio/button/input) ... --cyan
 *   - Lógica e Ações (delay/condition/action) ..... --purple
 *   - Pagamento (payment_button) .. --amber (exclusivo: dinheiro)
 *   - Não mapeado (unmapped) ...... --red (alerta: revisar antes de ativar)
 */
export interface NodeMeta {
  label: string;
  icon: string;
  color: string;
  category: string;
  description: string;
}

export const NODE_META: Record<string, NodeMeta> = {
  trigger: {
    label: "Gatilho",
    icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    color: "var(--accent)",
    category: "Inicio",
    description: "Ponto de entrada do fluxo (ex.: /start)",
  },
  text: {
    label: "Texto",
    icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
    color: "var(--cyan)",
    category: "Mensagens",
    description: "Envia uma mensagem de texto",
  },
  image: {
    label: "Imagem",
    icon: "M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z",
    color: "var(--cyan)",
    category: "Mensagens",
    description: "Envia uma imagem com legenda opcional",
  },
  video: {
    label: "Video",
    icon: "M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z",
    color: "var(--cyan)",
    category: "Mensagens",
    description: "Envia um vídeo com legenda opcional",
  },
  audio: {
    label: "Audio",
    // Microfone: o bloco manda mensagem de VOZ (bolha com waveform), não um
    // arquivo de música anexado — o ícone precisa dizer isso de cara.
    icon: "M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8",
    color: "var(--cyan)",
    category: "Mensagens",
    description: "Envia um áudio como mensagem de voz",
  },
  button: {
    label: "Botoes",
    icon: "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18",
    color: "var(--cyan)",
    category: "Mensagens",
    description: "Mensagem com botões de escolha",
  },
  input: {
    label: "Pergunta",
    icon: "M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z",
    color: "var(--cyan)",
    category: "Mensagens",
    description: "Pergunta e espera a resposta do lead pra continuar",
  },
  delay: {
    label: "Delay",
    icon: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2",
    color: "var(--purple)",
    category: "Logica",
    description: "Espera um tempo antes de continuar",
  },
  condition: {
    label: "Condicao",
    icon: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
    color: "var(--purple)",
    category: "Logica",
    description: "Ramifica o fluxo em Sim/Não",
  },
  action: {
    label: "Acao",
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    color: "var(--purple)",
    category: "Acoes",
    description: "Adiciona tag ou define variável",
  },
  payment_button: {
    label: "Pagamento",
    icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
    color: "var(--amber)",
    category: "Pagamento",
    description: "Envia cobrança de um conjunto de produtos",
  },
  unmapped: {
    label: "Nao mapeado",
    icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01",
    color: "var(--red)",
    category: "Pagamento",
    description: "Bloco clonado não mapeado — revisar antes de ativar",
  },
};

export const NODE_CATEGORIES = ["Inicio", "Mensagens", "Logica", "Acoes", "Pagamento"];

/** Cor de categoria por tipo de nó (minimapa, edges, etc.). */
export function nodeColor(type: string | undefined): string {
  return NODE_META[type ?? ""]?.color ?? "var(--text-secondary)";
}

/**
 * Estilo de Handle com hitbox de 24px e ponto visual de ~10px:
 * borda transparente de 7px empurra o background (clipado no content-box)
 * para um círculo central de 10px; o inset shadow desenha o anel de 2px
 * que antes era `border: 2px solid var(--bg-root)`.
 */
export function handleStyle(color: string): CSSProperties {
  return {
    width: 24,
    height: 24,
    background: color,
    border: "7px solid transparent",
    backgroundClip: "content-box",
    boxShadow: "inset 0 0 0 2px var(--bg-root)",
    borderRadius: "50%",
  };
}

/**
 * Rótulo + cor de uma aresta derivados do sourceHandle de origem.
 * Formatos de handle: "true"/"false" (condição), "paid"/"not_paid" e
 * "paid:btn_x"/"not_paid:btn_x" (pagamento), "reject" (recusa de oferta).
 * Retorna null para handles sem semântica fixa (botões custom, clones).
 */
export function edgeMetaForHandle(
  sourceHandle: string | null | undefined,
): { label: string; color: string } | null {
  if (!sourceHandle) return null;
  const key = sourceHandle.split(":")[0];
  switch (key) {
    case "true":
      return { label: "Sim", color: "var(--accent)" };
    case "false":
      return { label: "Não", color: "var(--red)" };
    case "paid":
      return { label: "Pagou", color: "var(--accent)" };
    case "not_paid":
      return { label: "Não pagou", color: "var(--red)" };
    case "reject":
      return { label: "Recusou", color: "var(--red)" };
    default:
      return null;
  }
}

/**
 * Motivo pelo qual um nó está incompleto (configuração obrigatória faltando),
 * ou null se está pronto. Usado pro badge visual no canvas e pro aviso no save.
 */
export function isNodeIncomplete(
  type: string | undefined,
  data: Record<string, unknown>,
): string | null {
  const str = (v: unknown) => String(v ?? "").trim();
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  switch (type) {
    case "trigger":
      return str(data.trigger ?? "command") === "command" && !str(data.command)
        ? "Comando do gatilho vazio"
        : null;
    case "text":
      return !str(data.text) && arr(data.text_variants).length === 0 ? "Mensagem vazia" : null;
    case "image":
      return !str(data.image_url) && arr(data.media_asset_ids).length === 0 ? "Sem imagem" : null;
    case "video":
      return !str(data.video_url) && arr(data.media_asset_ids).length === 0 ? "Sem vídeo" : null;
    case "audio":
      return !str(data.audio_url) ? "Sem áudio" : null;
    case "button":
      return arr(data.buttons).length === 0 ? "Sem botões" : null;
    case "condition":
      return !str(data.field) ? "Campo da condição vazio" : null;
    case "input":
      // Variável é opcional (pergunta pode ser só um gate de "responda pra
      // continuar"); o que não pode faltar é a pergunta em si.
      return !str(data.prompt) ? "Pergunta vazia" : null;
    case "action":
      return str(data.action_type ?? "set_variable") === "set_variable" && !str(data.variable)
        ? "Variável vazia"
        : null;
    case "payment_button":
      return !str(data.bundle_id) && arr(data.bundle_ids).length === 0
        ? "Sem conjunto de produtos"
        : null;
    case "unmapped":
      return "Bloco não mapeado";
    default:
      return null;
  }
}

export interface ButtonLike {
  id?: string;
  value?: string;
  action?: string;
}

/**
 * IDs de handle que UM botão realmente ganha no canvas — única fonte de
 * verdade, usada tanto pelo desenho do nó (button-node.tsx) quanto pela poda
 * de arestas órfãs (validSourceHandles abaixo) e pelo rename de aresta ao
 * editar um botão (flow-editor.tsx, handleUpdateNode). As três precisam bater
 * exatamente — divergir faz uma aresta editada não ser nem renomeada nem
 * podada, e sobrar órfã pra sempre.
 *
 * - "payment": 2 handles fixos, derivados do id (nunca do value) — bate com
 *   o callback_data que o botão de pagamento gera (button-node.tsx).
 * - "open_url" e "miniapp": nenhum handle — os dois viram botão que o cliente
 *   do Telegram abre sozinho (url e web_app, respectivamente), e a engine não
 *   gera callback_data pra nenhum dos dois (server/src/engine/nodes/button.ts).
 *   Sem callback_data não chega update nenhum ao servidor, então uma aresta
 *   saindo daí nunca dispararia: o lead tocaria, o app abriria, e o fluxo
 *   ficaria parado pra sempre.
 * - qualquer outra ação: 1 handle, derivado do value (o que a engine usa de
 *   verdade no callback_data comum — server/src/engine/nodes/button.ts).
 */
export function buttonHandleIds(b: ButtonLike, index: number): string[] {
  const btnId = String(b.id ?? "").trim() || `btn_idx_${index}`;
  if (b.action === "payment") return [`paid:${btnId}`, `not_paid:${btnId}`];
  if (b.action === "open_url" || b.action === "miniapp") return [];
  const plain = String(b.value ?? "").trim() || String(b.id ?? "").trim() || `btn_idx_${index}`;
  return [plain];
}

export interface RenamableEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

/**
 * Recalcula sourceHandle (e, pra "go_to_node", target) das arestas de um nó
 * "button" depois de uma edição — chamado por handleUpdateNode
 * (flow-editor.tsx) toda vez que a lista de botões de um nó muda.
 *
 * Bug real que esta função corrige: pra "go_to_node" o handle É o id do nó
 * de destino (buttonHandleIds deriva de value). A versão anterior só
 * renomeava o RÓTULO do handle da aresta (via um Map global, chave = string
 * do handle antigo) e deixava `target` intocado — trocar o destino no
 * seletor "Ir para no" fazia a aresta CONTINUAR desenhada (e o clique
 * continuar roteando) pro destino ANTIGO, mesmo com o painel já mostrando a
 * escolha nova. Um Map compartilhado também perdia operações quando 2
 * botões editados na mesma leva convergiam pro mesmo handle novo.
 *
 * Aqui cada rename é resolvido por INSTÂNCIA de aresta (edge.id), nunca por
 * uma tabela chaveada só pela string do handle, e — só pra "go_to_node" —
 * `target` acompanha o novo handle. No fim, poda duplicatas de
 * (source, sourceHandle): nunca é válido 2 arestas saírem do mesmo handle
 * (mesma semântica "1 saída por handle" do onConnect).
 */
export function renameButtonEdges<E extends RenamableEdge>(
  nodeId: string,
  oldButtons: ButtonLike[],
  newButtons: ButtonLike[],
  edges: E[],
): E[] {
  const opsByEdgeId = new Map<string, { sourceHandle: string; target?: string }>();
  oldButtons.forEach((oldBtn, i) => {
    const newIndex = oldBtn.id ? newButtons.findIndex((b) => b.id === oldBtn.id) : i;
    const newBtn = newIndex >= 0 ? newButtons[newIndex] : undefined;
    if (!newBtn) return; // botão removido — a poda de handles inválidos cuida da(s) aresta(s)
    const oldHandles = buttonHandleIds(oldBtn, i);
    const newHandles = buttonHandleIds(newBtn, newIndex);
    // Só renomeia handle-a-handle quando a CONTAGEM bate (ação não mudou):
    // 1-pra-1 (comum) ou 2-pra-2 (pagamento, paid/not_paid na mesma ordem).
    if (oldHandles.length !== newHandles.length) return;
    oldHandles.forEach((oldHandle, hi) => {
      const newHandle = newHandles[hi];
      if (oldHandle === newHandle) return;
      const edge = edges.find((e) => e.source === nodeId && e.sourceHandle === oldHandle);
      if (!edge) return;
      const followsTarget = newBtn.action === "go_to_node";
      opsByEdgeId.set(edge.id, { sourceHandle: newHandle, target: followsTarget ? newHandle : undefined });
    });
  });
  if (opsByEdgeId.size === 0) return edges;

  let renamed = edges.map((e) => {
    const op = opsByEdgeId.get(e.id);
    if (!op) return e;
    return { ...e, sourceHandle: op.sourceHandle, target: op.target ?? e.target };
  });

  const seenHandles = new Set<string>();
  renamed = renamed.filter((e) => {
    if (e.source !== nodeId || !e.sourceHandle) return true;
    const key = `${e.source}::${e.sourceHandle}`;
    if (seenHandles.has(key)) return false;
    seenHandles.add(key);
    return true;
  });

  return renamed;
}

/**
 * Conjunto de sourceHandles válidos de um nó dado seu data atual, para podar
 * arestas presas a handles que deixaram de existir (botão removido, sale_type
 * trocado, kind flow→link). Retorna null quando o tipo não tem handles
 * deriváveis com segurança — nesses casos NUNCA podar (ex.: unmapped e nós
 * clonados, cujos handles vêm do transcript).
 */
export function validSourceHandles(
  type: string | undefined,
  data: Record<string, unknown>,
): Set<string> | null {
  switch (type) {
    case "condition":
      return new Set(["true", "false"]);
    case "button": {
      const set = new Set<string>();
      const buttons = Array.isArray(data.buttons) ? (data.buttons as ButtonLike[]) : [];
      buttons.forEach((b, i) => {
        for (const handle of buttonHandleIds(b, i)) set.add(handle);
      });
      return set;
    }
    case "payment_button": {
      const set = new Set<string>(["paid", "not_paid"]);
      const saleType = String(data.sale_type ?? "main");
      if (saleType === "upsell" || saleType === "downsell") {
        const offers = Array.isArray(data.accept_reject_buttons)
          ? (data.accept_reject_buttons as { id?: string }[])
          : [];
        if (offers.length === 0) set.add("reject");
        for (const b of offers) if (b.id) set.add(String(b.id));
      }
      const custom = Array.isArray(data.custom_buttons)
        ? (data.custom_buttons as { id?: string; kind?: string }[])
        : [];
      for (const b of custom) if (b.kind === "flow" && b.id) set.add(String(b.id));
      return set;
    }
    default:
      return null;
  }
}
