import type { FlowNode, FlowEdge } from "../../../engine/types.js";
import { entitiesToHtml } from "./entities-to-html.js";
import type { PersistedMessage } from "./explorer.js";

export interface FlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface CapturedNodeForFlow {
  id: string; // bot_clone_nodes.id
  parentNodeId: string | null;
  triggeredByButtonId: string | null;
  status: "explored" | "duplicate" | "skipped_error";
  duplicateOfNodeId: string | null;
  messages: PersistedMessage[];
}

const SUPPORTED_MEDIA = new Set(["photo", "video"]);
const NODE_WIDTH_X = 260;
const SIBLING_HEIGHT_Y = 160;

interface IdGen {
  next(): string;
}
function makeIdGen(): IdGen {
  let n = 0;
  return { next: () => `n${n++}` };
}

interface TurnChain {
  capturedNodeId: string;
  /** Primeiro FlowNode do turno — alvo de qualquer edge vindo de FORA (botão do pai, ou back-edge de duplicata). */
  entryFlowNodeId: string;
  /** Nós de botão dentro deste turno, na ordem em que aparecem — cada um pode ter arestas de saída (uma por botão clicável). */
  buttonNodes: Array<{ msg: PersistedMessage; flowNodeId: string }>;
}

/**
 * Constrói o texto HTML + os botões (shape do button.ts) de UM PersistedMessage.
 */
function buildButtonNodeData(msg: PersistedMessage, textOverride?: string) {
  const text = textOverride ?? entitiesToHtml(msg.text ?? "", msg.entities);
  const buttons = msg.buttons.map((b) => ({
    text: b.label,
    action: b.kind === "url" || b.skip ? "open_url" : "next",
    // achado: botão pulado (guard ou url) fica com o rótulo original,
    // apontando pra um destino que a passada 2 resolve (unmapped, ou a
    // URL de verdade se o botão já era de link).
    value: b.kind === "url" ? (b.url ?? "") : b.id,
  }));
  return { text, buttons };
}

/** Emite a cadeia de FlowNodes de UM turno capturado (1+ mensagens). */
function buildTurnChain(
  node: CapturedNodeForFlow,
  ids: IdGen,
  depth: number,
  siblingIndex: number,
): { nodes: FlowNode[]; edges: FlowEdge[]; chain: TurnChain } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const buttonNodes: TurnChain["buttonNodes"] = [];
  let prevId: string | null = null;
  let seqInTurn = 0;

  const position = () => ({ x: depth * NODE_WIDTH_X, y: siblingIndex * SIBLING_HEIGHT_Y + seqInTurn * 40 });
  const link = (id: string) => {
    if (prevId) edges.push({ id: `e_${prevId}_${id}`, source: prevId, target: id });
    prevId = id;
    seqInTurn++;
  };

  for (const msg of node.messages) {
    const hasButtons = msg.buttons.length > 0;
    const mediaSupported = msg.mediaKind !== "none" && SUPPORTED_MEDIA.has(msg.mediaKind);
    const mediaUnsupported = msg.mediaKind !== "none" && !mediaSupported;

    // Mídia + botões juntos: o engine não tem um nó que manda os dois ao
    // mesmo tempo — encadeia mídia primeiro, depois o nó de botão (o texto
    // já foi pra legenda da mídia, o botão sai sem repetir).
    if ((mediaSupported || mediaUnsupported) && hasButtons) {
      const mediaId = ids.next();
      if (mediaSupported) {
        nodes.push({
          id: mediaId,
          type: msg.mediaKind === "video" ? "video" : "image",
          data:
            msg.mediaKind === "video"
              ? { video_url: msg.mediaPublicUrl ?? "", caption: entitiesToHtml(msg.text ?? "", msg.entities) }
              : { image_url: msg.mediaPublicUrl ?? "", caption: entitiesToHtml(msg.text ?? "", msg.entities) },
          position: position(),
        });
      } else {
        nodes.push({
          id: mediaId,
          type: "unmapped",
          data: { kind: "unsupported_media", media_kind: msg.mediaKind, media_public_url: msg.mediaPublicUrl, caption: msg.text ?? "" },
          position: position(),
        });
      }
      link(mediaId);

      const btnId = ids.next();
      nodes.push({ id: btnId, type: "button", data: buildButtonNodeData(msg, ""), position: position() });
      link(btnId);
      buttonNodes.push({ msg, flowNodeId: btnId });
      continue;
    }

    if (hasButtons) {
      const btnId = ids.next();
      nodes.push({ id: btnId, type: "button", data: buildButtonNodeData(msg), position: position() });
      link(btnId);
      buttonNodes.push({ msg, flowNodeId: btnId });
      continue;
    }

    if (mediaSupported) {
      const id = ids.next();
      nodes.push({
        id,
        type: msg.mediaKind === "video" ? "video" : "image",
        data:
          msg.mediaKind === "video"
            ? { video_url: msg.mediaPublicUrl ?? "", caption: entitiesToHtml(msg.text ?? "", msg.entities) }
            : { image_url: msg.mediaPublicUrl ?? "", caption: entitiesToHtml(msg.text ?? "", msg.entities) },
        position: position(),
      });
      link(id);
      continue;
    }

    if (mediaUnsupported) {
      const id = ids.next();
      nodes.push({
        id,
        type: "unmapped",
        data: { kind: "unsupported_media", media_kind: msg.mediaKind, media_public_url: msg.mediaPublicUrl, caption: msg.text ?? "" },
        position: position(),
      });
      link(id);
      continue;
    }

    // Texto puro.
    const id = ids.next();
    nodes.push({ id, type: "text", data: { text: entitiesToHtml(msg.text ?? "", msg.entities) }, position: position() });
    link(id);
  }

  // Turno sem mensagem nenhuma (não deveria acontecer, mas não trava a
  // reconstrução por causa disso) — nó de texto vazio como placeholder.
  if (nodes.length === 0) {
    const id = ids.next();
    nodes.push({ id, type: "text", data: { text: "" }, position: position() });
    prevId = id;
  }

  return {
    nodes,
    edges,
    chain: { capturedNodeId: node.id, entryFlowNodeId: nodes[0].id, buttonNodes },
  };
}

/**
 * Reconstrói o grafo de fluxo a partir dos turnos capturados. DUAS
 * PASSADAS (achado #6 da revisão adversarial): a passada 1 monta e atribui
 * o id de TODO turno primeiro; só a passada 2 emite as arestas entre
 * turnos (incluindo back-edges de duplicata/loop) — nunca aponta pra um id
 * que ainda não foi atribuído, o que uma reconstrução de passe único não
 * garante quando a ordem de visita não é cronológica.
 */
export function buildFlowGraph(nodes: CapturedNodeForFlow[]): FlowData {
  const explored = nodes.filter((n) => n.status === "explored");
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const allNodes: FlowNode[] = [];
  const allEdges: FlowEdge[] = [];
  const chains = new Map<string, TurnChain>(); // capturedNodeId -> chain

  // Passada 1: monta a cadeia de cada turno e atribui ids.
  const ids = makeIdGen();
  const depthOf = new Map<string, number>();
  {
    // depth por BFS a partir da raiz (parentNodeId null) — só pra layout,
    // não pra lógica.
    const queue: string[] = [];
    for (const n of explored) if (n.parentNodeId === null) { depthOf.set(n.id, 0); queue.push(n.id); }
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      const d = depthOf.get(cur) ?? 0;
      for (const n of explored) {
        if (n.parentNodeId === cur && !depthOf.has(n.id)) {
          depthOf.set(n.id, d + 1);
          queue.push(n.id);
        }
      }
    }
  }
  const siblingCounters = new Map<number, number>();
  for (const n of explored) {
    const depth = depthOf.get(n.id) ?? 0;
    const sibling = siblingCounters.get(depth) ?? 0;
    siblingCounters.set(depth, sibling + 1);
    const { nodes: turnNodes, edges: turnEdges, chain } = buildTurnChain(n, ids, depth, sibling);
    allNodes.push(...turnNodes);
    allEdges.push(...turnEdges);
    chains.set(n.id, chain);
  }

  // Raiz sintética: todo fluxo do engine espera um nó 'trigger' — mesmo
  // que a árvore capturada não tenha um conceito equivalente.
  const rootCaptured = explored.find((n) => n.parentNodeId === null);
  const triggerId = ids.next();
  allNodes.unshift({ id: triggerId, type: "trigger", data: { trigger: "command", command: "/start" }, position: { x: 0, y: 0 } });
  if (rootCaptured) {
    const rootChain = chains.get(rootCaptured.id);
    if (rootChain) allEdges.push({ id: `e_${triggerId}_${rootChain.entryFlowNodeId}`, source: triggerId, target: rootChain.entryFlowNodeId });
  }

  // Passada 2: arestas entre turnos — só agora todo id já existe.
  for (const n of explored) {
    const chain = chains.get(n.id);
    if (!chain) continue;
    for (const { msg, flowNodeId } of chain.buttonNodes) {
      for (const btn of msg.buttons) {
        if (btn.kind === "url" || btn.skip) continue; // botão de link não gera aresta; skip vira unmapped abaixo
        const child = findChild(nodes, n.id, btn.id);
        if (child && child.status === "explored") {
          const childChain = chains.get(child.id);
          if (childChain) {
            allEdges.push({ id: `e_${flowNodeId}_${btn.id}`, source: flowNodeId, target: childChain.entryFlowNodeId, sourceHandle: btn.id });
          }
          continue;
        }
        if (child && child.status === "duplicate" && child.duplicateOfNodeId) {
          const original = byId.get(child.duplicateOfNodeId);
          const originalChain = original ? chains.get(original.id) : undefined;
          if (originalChain) {
            // Back-edge de loop — aponta pro turno original, não pro
            // 'duplicate' (que não tem cadeia própria).
            allEdges.push({ id: `e_${flowNodeId}_${btn.id}`, source: flowNodeId, target: originalChain.entryFlowNodeId, sourceHandle: btn.id });
          }
          continue;
        }
        // Sem filho (nunca clicado — teto de profundidade/nós, erro, ou
        // job terminou antes de chegar aqui): nó unmapped explicando,
        // nunca uma aresta solta ou um botão silenciosamente sem destino.
        const unmappedId = ids.next();
        allNodes.push({
          id: unmappedId,
          type: "unmapped",
          data: { kind: "not_explored", original_label: btn.label, skip_reason: "not_explored_by_job_end" },
          position: { x: (depthOf.get(n.id) ?? 0) * NODE_WIDTH_X + NODE_WIDTH_X, y: 0 },
        });
        allEdges.push({ id: `e_${flowNodeId}_${btn.id}`, source: flowNodeId, target: unmappedId, sourceHandle: btn.id });
      }
      // Botões pulados pelo guard (não-url) também viram unmapped — motivo preservado.
      for (const btn of msg.buttons) {
        if (btn.kind === "url" || !btn.skip) continue;
        const unmappedId = ids.next();
        allNodes.push({
          id: unmappedId,
          type: "unmapped",
          data: { kind: "skipped_branch", original_label: btn.label, skip_reason: btn.skipReason },
          position: { x: (depthOf.get(n.id) ?? 0) * NODE_WIDTH_X + NODE_WIDTH_X, y: 0 },
        });
        allEdges.push({ id: `e_${flowNodeId}_${btn.id}`, source: flowNodeId, target: unmappedId, sourceHandle: btn.id });
      }
    }
  }

  return { nodes: allNodes, edges: allEdges };
}

function findChild(nodes: CapturedNodeForFlow[], parentNodeId: string, buttonId: string): CapturedNodeForFlow | undefined {
  return nodes.find((n) => n.parentNodeId === parentNodeId && n.triggeredByButtonId === buttonId);
}
