import { entitiesToHtml } from "./entities-to-html.js";
import { normalizeLabelForDedupKey } from "./price-parser.js";
const SUPPORTED_MEDIA = new Set(["photo", "video"]);
const NODE_WIDTH_X = 260;
const SIBLING_HEIGHT_Y = 160;
function makeIdGen() {
    let n = 0;
    return { next: () => `n${n++}` };
}
/**
 * Constrói o texto HTML + os botões (shape do button.ts) de UM PersistedMessage.
 */
function buildButtonNodeData(msg, textOverride) {
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
function buildTurnChain(node, ids, depth, siblingIndex) {
    const nodes = [];
    const edges = [];
    const buttonNodes = [];
    let prevId = null;
    let seqInTurn = 0;
    const position = () => ({ x: depth * NODE_WIDTH_X, y: siblingIndex * SIBLING_HEIGHT_Y + seqInTurn * 40 });
    const link = (id) => {
        if (prevId)
            edges.push({ id: `e_${prevId}_${id}`, source: prevId, target: id });
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
                    data: msg.mediaKind === "video"
                        ? { video_url: msg.mediaPublicUrl ?? "", caption: entitiesToHtml(msg.text ?? "", msg.entities) }
                        : { image_url: msg.mediaPublicUrl ?? "", caption: entitiesToHtml(msg.text ?? "", msg.entities) },
                    position: position(),
                });
            }
            else {
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
                data: msg.mediaKind === "video"
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
export function buildFlowGraph(nodes, priceMap) {
    const explored = nodes.filter((n) => n.status === "explored");
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const allNodes = [];
    const allEdges = [];
    const chains = new Map(); // capturedNodeId -> chain
    // Passada 1: monta a cadeia de cada turno e atribui ids.
    const ids = makeIdGen();
    const depthOf = new Map();
    {
        // depth por BFS a partir da raiz (parentNodeId null) — só pra layout,
        // não pra lógica.
        const queue = [];
        for (const n of explored)
            if (n.parentNodeId === null) {
                depthOf.set(n.id, 0);
                queue.push(n.id);
            }
        while (queue.length > 0) {
            const cur = queue.shift();
            const d = depthOf.get(cur) ?? 0;
            for (const n of explored) {
                if (n.parentNodeId === cur && !depthOf.has(n.id)) {
                    depthOf.set(n.id, d + 1);
                    queue.push(n.id);
                }
            }
        }
    }
    const siblingCounters = new Map();
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
        if (rootChain)
            allEdges.push({ id: `e_${triggerId}_${rootChain.entryFlowNodeId}`, source: triggerId, target: rootChain.entryFlowNodeId });
    }
    // Passada 2: arestas entre turnos — só agora todo id já existe.
    for (const n of explored) {
        const chain = chains.get(n.id);
        if (!chain)
            continue;
        for (const { msg, flowNodeId } of chain.buttonNodes) {
            for (const btn of msg.buttons) {
                if (btn.kind === "url" || btn.skip)
                    continue; // botão de link não gera aresta; skip vira unmapped abaixo
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
            // Botões pulados pelo guard (não-url): se o preço deu pra extrair e um
            // produto já foi criado pro rótulo (priceMap, montado pelo chamador
            // antes de qualquer buildFlowGraph), vira payment_button de verdade;
            // senão cai no unmapped de sempre, motivo preservado.
            for (const btn of msg.buttons) {
                if (btn.kind === "url" || !btn.skip)
                    continue;
                const position = { x: (depthOf.get(n.id) ?? 0) * NODE_WIDTH_X + NODE_WIDTH_X, y: 0 };
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
function findChild(nodes, parentNodeId, buttonId) {
    return nodes.find((n) => n.parentNodeId === parentNodeId && n.triggeredByButtonId === buttonId);
}
