import { describe, it, expect } from "vitest";
import { renameButtonEdges, buttonHandleIds, validSourceHandles, type ButtonLike, type RenamableEdge } from "@/components/dashboard/flow-builder/flow-utils";

describe("renameButtonEdges", () => {
  it("moves the edge target (not just the handle label) when a go_to_node button's destination changes", () => {
    // Reprodução do bug real: nó "Escolha/Choice" com 1 botão "Ir para no"
    // já conectado ao node A no canvas; o admin troca o destino pro node B
    // no seletor. A aresta desenhada tinha que SEGUIR pro node B — antes da
    // correção ela ficava presa em A (só o rótulo do handle mudava).
    const nodeId = "choice";
    const oldButtons: ButtonLike[] = [
      { id: "btn_1", action: "go_to_node", value: "nodeA" },
    ];
    const newButtons: ButtonLike[] = [
      { id: "btn_1", action: "go_to_node", value: "nodeB" },
    ];
    const edges: RenamableEdge[] = [
      { id: "e1", source: nodeId, sourceHandle: "nodeA", target: "nodeA" },
    ];

    const result = renameButtonEdges(nodeId, oldButtons, newButtons, edges);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "e1", sourceHandle: "nodeB", target: "nodeB" });
  });

  it("routes both branches of a real US/BR choice node to their own distinct targets", () => {
    // Mesma forma do nó real que motivou a investigação: 2 botões go_to_node
    // no mesmo nó, cada um apontando pra um branch diferente.
    const nodeId = "button-f137fa27";
    const oldButtons: ButtonLike[] = [
      { id: "btn_us", action: "go_to_node", value: "button-1c80ec6a" },
      { id: "btn_br", action: "go_to_node", value: "n2" },
    ];
    // Admin troca os dois destinos (ex.: apontava pro node errado em ambos).
    const newButtons: ButtonLike[] = [
      { id: "btn_us", action: "go_to_node", value: "nodeUS_v2" },
      { id: "btn_br", action: "go_to_node", value: "nodeBR_v2" },
    ];
    const edges: RenamableEdge[] = [
      { id: "e_us", source: nodeId, sourceHandle: "button-1c80ec6a", target: "button-1c80ec6a" },
      { id: "e_br", source: nodeId, sourceHandle: "n2", target: "n2" },
    ];

    const result = renameButtonEdges(nodeId, oldButtons, newButtons, edges);

    const us = result.find((e) => e.id === "e_us");
    const br = result.find((e) => e.id === "e_br");
    expect(us).toMatchObject({ sourceHandle: "nodeUS_v2", target: "nodeUS_v2" });
    expect(br).toMatchObject({ sourceHandle: "nodeBR_v2", target: "nodeBR_v2" });
  });

  it("drops the stale duplicate when two buttons converge onto the same handle after an edit", () => {
    // Botão B muda pro mesmo destino que o botão A já usa (sem editar A).
    // A aresta renomeada de B não pode sobreviver DUPLICADA com a de A no
    // mesmo (source, sourceHandle) — só uma aresta por handle é válida.
    const nodeId = "node1";
    const oldButtons: ButtonLike[] = [
      { id: "a", action: "go_to_node", value: "nodeA" },
      { id: "b", action: "go_to_node", value: "nodeB" },
    ];
    const newButtons: ButtonLike[] = [
      { id: "a", action: "go_to_node", value: "nodeA" }, // inalterado
      { id: "b", action: "go_to_node", value: "nodeA" }, // agora converge pra A
    ];
    const edges: RenamableEdge[] = [
      { id: "e_a", source: nodeId, sourceHandle: "nodeA", target: "nodeA" },
      { id: "e_b", source: nodeId, sourceHandle: "nodeB", target: "nodeB" },
    ];

    const result = renameButtonEdges(nodeId, oldButtons, newButtons, edges);

    const forNode = result.filter((e) => e.source === nodeId);
    expect(forNode).toHaveLength(1);
    expect(forNode[0]).toMatchObject({ sourceHandle: "nodeA", target: "nodeA" });
  });

  it("does not touch edges when the edit leaves button value/action unchanged", () => {
    const nodeId = "node1";
    const oldButtons: ButtonLike[] = [{ id: "a", action: "go_to_node", value: "nodeA" }];
    const newButtons: ButtonLike[] = [{ id: "a", action: "go_to_node", value: "nodeA" }];
    const edges: RenamableEdge[] = [
      { id: "e_a", source: nodeId, sourceHandle: "nodeA", target: "nodeA" },
    ];

    const result = renameButtonEdges(nodeId, oldButtons, newButtons, edges);

    expect(result).toBe(edges); // mesma referência — nenhuma edição, nenhum novo array
  });

  it("keeps paid/not_paid edges pinned to the button id (not target) when a payment button's target node is unrelated", () => {
    // Botão de pagamento: handle deriva de id, não de value — renomear o
    // texto do botão não deve mexer nas arestas paid:/not_paid:.
    const nodeId = "node1";
    const oldButtons: ButtonLike[] = [{ id: "btn_0", action: "payment" }];
    const newButtons: ButtonLike[] = [{ id: "btn_0", action: "payment" }];
    const edges: RenamableEdge[] = [
      { id: "e_paid", source: nodeId, sourceHandle: "paid:btn_0", target: "access" },
      { id: "e_notpaid", source: nodeId, sourceHandle: "not_paid:btn_0", target: "retry" },
    ];

    const result = renameButtonEdges(nodeId, oldButtons, newButtons, edges);

    expect(result).toBe(edges);
  });
});

describe("buttonHandleIds / validSourceHandles — botões sem callback_data", () => {
  it("não dá handle de saída pro botão de Mini App (a engine devolve web_app, sem callback_data)", () => {
    // server/src/engine/nodes/button.ts monta { text, web_app } pro "miniapp",
    // exatamente como faz { text, url } pro "open_url": nenhum dos dois gera
    // callback_data, então nenhum update chega ao servidor e uma aresta saindo
    // daí NUNCA dispararia — o lead toca, o app abre, o fluxo trava.
    expect(buttonHandleIds({ id: "b1", action: "miniapp", value: "x" }, 0)).toEqual([]);
    expect(buttonHandleIds({ id: "b1", action: "open_url", value: "x" }, 0)).toEqual([]);
    // Contraprova: ação comum continua com o seu handle.
    expect(buttonHandleIds({ id: "b1", action: "callback", value: "x" }, 0)).toEqual(["x"]);
  });

  it("poda a aresta velha quando um botão vira Mini App (a contagem cai de 1 pra 0)", () => {
    // Antes da correção "miniapp" devolvia 1 handle: a contagem batia 1→1, o
    // rename PRESERVAVA a aresta e validSourceHandles ainda a considerava
    // válida — sobrava uma conexão desenhada que nunca ia disparar.
    const nodeId = "node1";
    const oldButtons: ButtonLike[] = [{ id: "b1", action: "callback", value: "x" }];
    const newButtons: ButtonLike[] = [{ id: "b1", action: "miniapp", value: "x" }];
    const edges: RenamableEdge[] = [
      { id: "e1", source: nodeId, sourceHandle: "x", target: "proximo" },
    ];

    // Contagem 1→0: o rename não tem par pra renomear e devolve tudo intacto.
    const renamed = renameButtonEdges(nodeId, oldButtons, newButtons, edges);
    // Quem apaga é a poda — e ela precisa NÃO ver mais o handle "x".
    const valid = validSourceHandles("button", { buttons: newButtons });
    expect(valid).not.toBeNull();
    expect(valid!.has("x")).toBe(false);
    expect(renamed.filter((e) => !e.sourceHandle || valid!.has(e.sourceHandle))).toHaveLength(0);
  });
});
