import type { FlowNode, FlowEdge } from "../../../engine/types.js";
import { entitiesToHtml } from "./entities-to-html.js";
import type { PersistedMessage } from "./explorer.js";
import { normalizeLabelForDedupKey } from "./price-parser.js";

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
// Passo vertical por nó — generoso o bastante pro maior card comum do editor
// nunca ficar visualmente empilhado atrás do anterior. Raiz do bug original:
// um turno com 2+ mensagens sequenciais (ex.: duas fotos seguidas) empilhava
// os nós a só 40px um do outro, quase sobrepostos — o segundo nó (com a
// mídia ANTIGA) ficava escondido atrás do primeiro, indistinguível de "1
// bloco só" no canvas; o usuário editava o visível achando que tinha
// corrigido tudo, mas o engine continuava mandando os dois em sequência.
const BASE_STEP_Y = 220;
// Nó de botão cresce com a quantidade de botões (1 linha por botão,
// button-node.tsx) — um passo fixo não escala: a partir de ~4 botões o card
// já é mais alto que qualquer constante fixa razoável, reintroduzindo a
// mesma sobreposição que este ajuste existe pra evitar.
const BUTTON_STEP_PER_BUTTON_Y = 60;
// Respiro entre turnos irmãos na mesma profundidade (coluna X), além da
// altura REAL que cada um consumiu — turnos não têm tamanho fixo (uma rajada
// capturada pode ter várias mensagens), então usar um múltiplo fixo por
// índice de irmão (o esquema antigo) deixava de bastar assim que um turno
// tinha mensagens demais e invadia a linha do próximo. Por isso a posição Y
// de cada turno agora vem de um cursor por profundidade (depthYCursor, em
// buildFlowGraph) que avança pela altura real do turno anterior, nunca por
// uma suposição de tamanho.
const SIBLING_GAP_Y = 120;

/** Altura vertical que UM nó do editor reserva no layout, pelo seu tipo. */
function stepHeightFor(nodeType: string, buttonCount = 0): number {
  return nodeType === "button" ? BASE_STEP_Y + buttonCount * BUTTON_STEP_PER_BUTTON_Y : BASE_STEP_Y;
}

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
    // Só botão de link de verdade vira "open_url" (tem URL real). Botão
    // pulado pelo guard (ex.: payment_keyword_match) não tem URL — precisa
    // continuar como botão de callback ("next") pra disparar de verdade e
    // a aresta pro nó unmapped (passada 2) ser alcançável. Antes disso
    // incluía `|| b.skip` aqui, então todo botão de preço pulado virava um
    // link quebrado com a URL vazia, e nunca disparava callback nenhum.
    action: b.kind === "url" ? "open_url" : "next",
    // botão pulado (guard ou url) fica com o rótulo original, apontando
    // pra um destino que a passada 2 resolve (unmapped, ou a URL de
    // verdade se o botão já era de link).
    value: b.kind === "url" ? (b.url ?? "") : b.id,
  }));
  return { text, buttons };
}

/** Emite a cadeia de FlowNodes de UM turno capturado (1+ mensagens). */
function buildTurnChain(
  node: CapturedNodeForFlow,
  ids: IdGen,
  depth: number,
  startY: number,
): { nodes: FlowNode[]; edges: FlowEdge[]; chain: TurnChain; endY: number } {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const buttonNodes: TurnChain["buttonNodes"] = [];
  let prevId: string | null = null;
  let yCursor = startY;

  const position = () => ({ x: depth * NODE_WIDTH_X, y: yCursor });
  const link = (id: string, stepHeight: number) => {
    if (prevId) edges.push({ id: `e_${prevId}_${id}`, source: prevId, target: id });
    prevId = id;
    yCursor += stepHeight;
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
      link(mediaId, BASE_STEP_Y);

      const btnId = ids.next();
      const btnData = buildButtonNodeData(msg, "");
      nodes.push({ id: btnId, type: "button", data: btnData, position: position() });
      link(btnId, stepHeightFor("button", btnData.buttons.length));
      buttonNodes.push({ msg, flowNodeId: btnId });
      continue;
    }

    if (hasButtons) {
      const btnId = ids.next();
      const btnData = buildButtonNodeData(msg);
      nodes.push({ id: btnId, type: "button", data: btnData, position: position() });
      link(btnId, stepHeightFor("button", btnData.buttons.length));
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
      link(id, BASE_STEP_Y);
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
      link(id, BASE_STEP_Y);
      continue;
    }

    // Texto puro.
    const id = ids.next();
    nodes.push({ id, type: "text", data: { text: entitiesToHtml(msg.text ?? "", msg.entities) }, position: position() });
    link(id, BASE_STEP_Y);
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
    endY: yCursor,
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
export function buildFlowGraph(nodes: CapturedNodeForFlow[], priceMap?: Map<string, string>): FlowData {
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
  // Cursor Y por profundidade (coluna X): cada turno começa onde o anterior
  // NA MESMA coluna realmente terminou, nunca por um múltiplo fixo de índice
  // — turnos não têm tamanho previsível (mensagens/botões variam), e um
  // espaçamento fixo por índice de irmão só vale até o primeiro turno grande
  // demais pra ele, quando volta a empilhar em cima do próximo. A mesma
  // coluna também é reaproveitada pelos placeholders da passada 2 abaixo
  // (nós "não explorado"/"pulado"), então eles nascem sempre abaixo de
  // qualquer conteúdo real já colocado ali, nunca por cima.
  const depthYCursor = new Map<number, number>();
  for (const n of explored) {
    const depth = depthOf.get(n.id) ?? 0;
    const startY = depthYCursor.get(depth) ?? 0;
    const { nodes: turnNodes, edges: turnEdges, chain, endY } = buildTurnChain(n, ids, depth, startY);
    allNodes.push(...turnNodes);
    allEdges.push(...turnEdges);
    chains.set(n.id, chain);
    depthYCursor.set(depth, endY + SIBLING_GAP_Y);
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
        // Posição vem do MESMO cursor por profundidade da passada 1 (nunca
        // y:0 fixo) — placeholders de turnos-irmãos diferentes na mesma
        // coluna não ficam mais empilhados uns sobre os outros.
        const colDepth = (depthOf.get(n.id) ?? 0) + 1;
        const placeholderY = depthYCursor.get(colDepth) ?? 0;
        depthYCursor.set(colDepth, placeholderY + BASE_STEP_Y + SIBLING_GAP_Y);
        const unmappedId = ids.next();
        allNodes.push({
          id: unmappedId,
          type: "unmapped",
          data: { kind: "not_explored", original_label: btn.label, skip_reason: "not_explored_by_job_end" },
          position: { x: colDepth * NODE_WIDTH_X, y: placeholderY },
        });
        allEdges.push({ id: `e_${flowNodeId}_${btn.id}`, source: flowNodeId, target: unmappedId, sourceHandle: btn.id });
      }
      // Botões pulados pelo guard (não-url): se o preço deu pra extrair e um
      // produto já foi criado pro rótulo (priceMap, montado pelo chamador
      // antes de qualquer buildFlowGraph), vira payment_button de verdade;
      // senão cai no unmapped de sempre, motivo preservado. Posição por
      // botão (não mais 1 posição reaproveitada pra todos os botões pulados
      // da mesma mensagem — isso empilhava 2+ placeholders exatamente no
      // mesmo x,y quando uma mensagem tinha vários botões pulados).
      for (const btn of msg.buttons) {
        if (btn.kind === "url" || !btn.skip) continue;
        const colDepth = (depthOf.get(n.id) ?? 0) + 1;
        const placeholderY = depthYCursor.get(colDepth) ?? 0;
        depthYCursor.set(colDepth, placeholderY + BASE_STEP_Y + SIBLING_GAP_Y);
        const position = { x: colDepth * NODE_WIDTH_X, y: placeholderY };
        const bundleId = priceMap?.get(normalizeLabelForDedupKey(btn.label));
        if (bundleId) {
          const paymentId = ids.next();
          allNodes.push({
            id: paymentId,
            type: "payment_button",
            data: { bundle_id: bundleId, sale_type: "main" },
            position,
          });
          allEdges.push({ id: `e_${flowNodeId}_${btn.id}`, source: flowNodeId, target: paymentId, sourceHandle: btn.id });
          continue;
        }
        const unmappedId = ids.next();
        allNodes.push({
          id: unmappedId,
          type: "unmapped",
          data: { kind: "skipped_branch", original_label: btn.label, skip_reason: btn.skipReason },
          position,
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
