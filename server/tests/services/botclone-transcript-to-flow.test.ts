import { describe, it, expect } from "vitest";
import { buildFlowGraph, type CapturedNodeForFlow } from "../../src/services/mtproto/bot-clone/transcript-to-flow.js";
import type { PersistedButton, PersistedMessage } from "../../src/services/mtproto/bot-clone/explorer.js";

function msg(over: Partial<PersistedMessage> = {}): PersistedMessage {
  return {
    seq: 0,
    rawMsgId: 1,
    text: "oi",
    entities: [],
    mediaKind: "none",
    mediaPublicUrl: null,
    buttons: [],
    ...over,
  };
}

function btn(over: Partial<PersistedButton> = {}): PersistedButton {
  return {
    id: "b0_0",
    kind: "callback",
    label: "Ver mais",
    url: null,
    data: Buffer.from("x").toString("base64"),
    skip: false,
    skipReason: null,
    paymentDomainMatch: false,
    ...over,
  };
}

describe("buildFlowGraph", () => {
  it("raiz vira nó trigger sintético apontando pro primeiro nó do turno raiz", () => {
    const nodes: CapturedNodeForFlow[] = [
      { id: "root", parentNodeId: null, triggeredByButtonId: null, status: "explored", duplicateOfNodeId: null, messages: [msg({ text: "Bem-vindo" })] },
    ];
    const flow = buildFlowGraph(nodes);
    const trigger = flow.nodes.find((n) => n.type === "trigger");
    expect(trigger).toBeDefined();
    expect(trigger?.data).toEqual({ trigger: "command", command: "/start" });
    const textNode = flow.nodes.find((n) => n.type === "text");
    expect(textNode?.data.text).toBe("Bem-vindo");
    const edge = flow.edges.find((e) => e.source === trigger?.id);
    expect(edge?.target).toBe(textNode?.id);
  });

  it("burst de 3 mensagens (texto + foto + botões) vira cadeia de 3 nós ligados por aresta", () => {
    const nodes: CapturedNodeForFlow[] = [
      {
        id: "root",
        parentNodeId: null,
        triggeredByButtonId: null,
        status: "explored",
        duplicateOfNodeId: null,
        messages: [
          msg({ seq: 0, text: "intro" }),
          msg({ seq: 1, text: "veja a foto", mediaKind: "photo", mediaPublicUrl: "https://x/a.jpg" }),
          msg({ seq: 2, text: "escolha", buttons: [btn({ id: "b2_0", label: "Opção A" })] }),
        ],
      },
    ];
    const flow = buildFlowGraph(nodes);
    // ordem: os 3 nós do turno primeiro (texto, foto, botão); o unmapped do
    // botão "Opção A" (sem filho) só é anexado na passada 2, depois.
    const contentTypes = flow.nodes.filter((n) => n.type !== "trigger").map((n) => n.type);
    expect(contentTypes).toEqual(["text", "image", "button", "unmapped"]);

    const textN = flow.nodes.find((n) => n.type === "text")!;
    const imgN = flow.nodes.find((n) => n.type === "image")!;
    const btnN = flow.nodes.find((n) => n.type === "button")!;
    expect(imgN.data).toEqual({ image_url: "https://x/a.jpg", caption: "veja a foto" });
    expect(flow.edges.some((e) => e.source === textN.id && e.target === imgN.id)).toBe(true);
    expect(flow.edges.some((e) => e.source === imgN.id && e.target === btnN.id)).toBe(true);
  });

  it("botão pulado pelo guard preserva o rótulo original e vira nó unmapped com o motivo", () => {
    const nodes: CapturedNodeForFlow[] = [
      {
        id: "root",
        parentNodeId: null,
        triggeredByButtonId: null,
        status: "explored",
        duplicateOfNodeId: null,
        messages: [msg({ buttons: [btn({ id: "b0_0", label: "Comprar agora", skip: true, skipReason: "payment_keyword_match", data: null })] })],
      },
    ];
    const flow = buildFlowGraph(nodes);
    const btnNode = flow.nodes.find((n) => n.type === "button")!;
    const edge = flow.edges.find((e) => e.source === btnNode.id)!;
    const target = flow.nodes.find((n) => n.id === edge.target)!;
    expect(target.type).toBe("unmapped");
    expect(target.data).toEqual({ kind: "skipped_branch", original_label: "Comprar agora", skip_reason: "payment_keyword_match" });
    // o botão em si mantém o rótulo original na cadeia visual, e continua
    // disparando callback ("next") — não tem URL real, então "open_url"
    // quebraria o botão e nunca alcançaria o nó unmapped abaixo.
    expect(btnNode.data.buttons).toEqual([{ text: "Comprar agora", action: "next", value: "b0_0" }]);
  });

  it("botão não explorado (sem filho, sem skip — teto atingido) vira unmapped 'not_explored', nunca aresta solta", () => {
    const nodes: CapturedNodeForFlow[] = [
      {
        id: "root",
        parentNodeId: null,
        triggeredByButtonId: null,
        status: "explored",
        duplicateOfNodeId: null,
        messages: [msg({ buttons: [btn({ id: "b0_0", label: "Próxima página" })] })],
      },
      // nenhum nó filho com parentNodeId="root" e triggeredByButtonId="b0_0" — nunca foi clicado (teto).
    ];
    const flow = buildFlowGraph(nodes);
    const btnNode = flow.nodes.find((n) => n.type === "button")!;
    const edge = flow.edges.find((e) => e.source === btnNode.id)!;
    expect(edge).toBeDefined();
    const target = flow.nodes.find((n) => n.id === edge.target)!;
    expect(target.type).toBe("unmapped");
    expect(target.data).toMatchObject({ kind: "not_explored", original_label: "Próxima página" });
  });

  it("mídia não suportada (documento) vira nó unmapped, nunca é descartada", () => {
    const nodes: CapturedNodeForFlow[] = [
      {
        id: "root",
        parentNodeId: null,
        triggeredByButtonId: null,
        status: "explored",
        duplicateOfNodeId: null,
        messages: [msg({ mediaKind: "document", mediaPublicUrl: "https://x/a.pdf", text: "seu arquivo" })],
      },
    ];
    const flow = buildFlowGraph(nodes);
    const unmapped = flow.nodes.find((n) => n.type === "unmapped")!;
    expect(unmapped.data).toEqual({ kind: "unsupported_media", media_kind: "document", media_public_url: "https://x/a.pdf", caption: "seu arquivo" });
  });

  it("duplicata (loop) produz um back-edge de verdade, nunca aponta pra um id não atribuído — mesmo com a ordem do array embaralhada (achado estrutural #6)", () => {
    // Ordem deliberadamente fora de sequência cronológica: nodeB e a
    // duplicata vêm ANTES de root/nodeA no array — uma reconstrução de
    // passe único correria risco de emitir a aresta de volta pra root
    // antes do id de root existir.
    const nodes: CapturedNodeForFlow[] = [
      {
        id: "nodeB",
        parentNodeId: "nodeA",
        triggeredByButtonId: "toB",
        status: "explored",
        duplicateOfNodeId: null,
        messages: [msg({ text: "menu B", buttons: [btn({ id: "toRootAgain", label: "Voltar ao início" })] })],
      },
      {
        id: "dup1",
        parentNodeId: "nodeB",
        triggeredByButtonId: "toRootAgain",
        status: "duplicate",
        duplicateOfNodeId: "root",
        messages: [],
      },
      {
        id: "root",
        parentNodeId: null,
        triggeredByButtonId: null,
        status: "explored",
        duplicateOfNodeId: null,
        messages: [msg({ text: "menu raiz", buttons: [btn({ id: "toA", label: "Ir pra A" })] })],
      },
      {
        id: "nodeA",
        parentNodeId: "root",
        triggeredByButtonId: "toA",
        status: "explored",
        duplicateOfNodeId: null,
        messages: [msg({ text: "menu A", buttons: [btn({ id: "toB", label: "Ir pra B" })] })],
      },
    ];

    const flow = buildFlowGraph(nodes);

    // Todo id referenciado por uma aresta precisa existir de fato entre os nós emitidos.
    const nodeIds = new Set(flow.nodes.map((n) => n.id));
    for (const e of flow.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }

    // A aresta de "Voltar ao início" (nodeB -> duplicata de root) aponta
    // pro MESMO id do nó de entrada do turno raiz de verdade — um back-edge
    // genuíno, não uma referência solta nem um nó novo redundante.
    // Raiz tem botão próprio (não é nó de texto puro): a entrada do turno
    // raiz é o nó tipo "button" com o texto "menu raiz".
    const rootEntryNode = flow.nodes.find((n) => n.type === "button" && (n.data.text as string) === "menu raiz")!;
    const nodeBButton = flow.nodes.find((n) => n.type === "button" && (n.data.text as string) === "menu B")!;
    const backEdge = flow.edges.find((e) => e.source === nodeBButton.id)!;
    expect(backEdge.target).toBe(rootEntryNode.id);
  });
});
