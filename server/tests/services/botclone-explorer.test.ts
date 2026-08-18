import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
import {
  BotExplorer,
  type BotExplorerDeps,
  type BotExplorerConfig,
  type RawCapturedMessage,
  type ExistingNode,
  type PersistNodeInput,
} from "../../src/services/mtproto/bot-clone/explorer.js";

function callbackBtn(text: string, data = "x"): Api.KeyboardButtonCallback {
  return new Api.KeyboardButtonCallback({ text, data: Buffer.from(data), requiresPassword: false } as never);
}

function burst(text: string, buttons: Api.TypeKeyboardButton[] = [], rawMsgId = 1): RawCapturedMessage[] {
  return [{ rawMsgId, text, entities: undefined, mediaKind: "none", media: null, fileName: null, rawButtons: buttons }];
}

function cfg(over: Partial<BotExplorerConfig> = {}): BotExplorerConfig {
  return { maxDepth: 40, maxNodes: 500, clickThrottleMs: 0, ...over };
}

function makeDeps(over: Partial<BotExplorerDeps> = {}): BotExplorerDeps & {
  persisted: PersistNodeInput[];
  clickedButtons: Array<{ msgId: number; data: Buffer }>;
} {
  const persisted: PersistNodeInput[] = [];
  const clickedButtons: Array<{ msgId: number; data: Buffer }> = [];
  let nextId = 1;
  const base: BotExplorerDeps = {
    sendStart: vi.fn(async () => {}),
    clickButton: vi.fn(async (msgId: number, data: Buffer) => {
      clickedButtons.push({ msgId, data });
    }),
    captureBurst: vi.fn(async () => burst("resposta padrão")),
    rehostMedia: vi.fn(async () => null),
    loadExistingNodes: vi.fn(async () => []),
    persistNode: vi.fn(async (row: PersistNodeInput) => {
      persisted.push(row);
      return `node${nextId++}`;
    }),
    getStatus: vi.fn(async () => "exploring"),
    delay: vi.fn(async () => {}),
    ...over,
  };
  return Object.assign(base, { persisted, clickedButtons });
}

describe("BotExplorer", () => {
  it("manda /start, persiste a raiz, explora cada botão descoberto", async () => {
    const deps = makeDeps({
      captureBurst: vi
        .fn()
        .mockResolvedValueOnce(burst("Bem-vindo!", [callbackBtn("Ver planos"), callbackBtn("Sobre")]))
        .mockResolvedValueOnce(burst("Planos aqui"))
        .mockResolvedValueOnce(burst("Sobre nós")),
    });
    await new BotExplorer(deps, cfg()).run();

    expect(deps.sendStart).toHaveBeenCalledTimes(1);
    expect(deps.persisted).toHaveLength(3); // raiz + 2 filhos
    expect(deps.persisted[0].parentNodeId).toBeNull();
    expect(deps.persisted[0].status).toBe("explored");
    expect(deps.clickedButtons).toHaveLength(2);
  });

  it("botão classificado como skip (payment-guard) nunca é clicado", async () => {
    const deps = makeDeps({
      captureBurst: vi.fn().mockResolvedValueOnce(burst("Bem-vindo!", [callbackBtn("Comprar agora")])),
    });
    await new BotExplorer(deps, cfg()).run();

    expect(deps.clickButton).not.toHaveBeenCalled();
    expect(deps.persisted[0].messages[0].buttons[0]).toMatchObject({
      skip: true,
      skipReason: "payment_keyword_match",
    });
  });

  it("teto de profundidade: clique além do maxDepth nunca dispara (achado #9)", async () => {
    const deps = makeDeps({
      captureBurst: vi
        .fn()
        .mockResolvedValueOnce(burst("nível 0", [callbackBtn("ir")])) // start -> depth0
        .mockResolvedValueOnce(burst("nível 1", [callbackBtn("ir mais")])), // depth1 -> teria filho depth2
    });
    await new BotExplorer(deps, cfg({ maxDepth: 1 })).run();

    // depth0 (raiz) e depth1 (1 clique) são processados; o botão de depth1
    // geraria um filho em depth2, que excede maxDepth=1 — nunca clicado.
    expect(deps.clickButton).toHaveBeenCalledTimes(1);
    expect(deps.persisted).toHaveLength(2);
  });

  it("teto de nós: para de clicar assim que exploredCount atinge maxNodes, mesmo com fila cheia", async () => {
    const deps = makeDeps({
      captureBurst: vi
        .fn()
        .mockResolvedValueOnce(burst("raiz", [callbackBtn("a"), callbackBtn("b")]))
        .mockResolvedValueOnce(burst("filho a"))
        .mockResolvedValueOnce(burst("filho b")),
    });
    // maxNodes=2: só a raiz + 1 filho cabem; o 2º filho nunca é clicado.
    await new BotExplorer(deps, cfg({ maxNodes: 2 })).run();

    expect(deps.clickButton).toHaveBeenCalledTimes(1);
    expect(deps.persisted).toHaveLength(2);
  });

  it("loop (fingerprint repetida): marca 'duplicate', não recursa, não gasta rehost de mídia", async () => {
    const deps = makeDeps({
      captureBurst: vi
        .fn()
        .mockResolvedValueOnce(burst("Menu principal", [callbackBtn("Ver mais")]))
        .mockResolvedValueOnce(burst("Menu principal", [callbackBtn("Ver mais")])), // mesmo estado de novo
    });
    await new BotExplorer(deps, cfg()).run();

    expect(deps.persisted).toHaveLength(2);
    expect(deps.persisted[1].status).toBe("duplicate");
    expect(deps.persisted[1].duplicateOfNodeId).toBe("node1");
    expect(deps.persisted[1].messages).toEqual([]); // conteúdo do revisit não persistido
    expect(deps.clickButton).toHaveBeenCalledTimes(1); // não recursou pro filho do duplicate
    expect(deps.rehostMedia).not.toHaveBeenCalled();
  });

  it("scanner pós-clique: sinaliza suspeita de pagamento MAS continua explorando (decisão do usuário)", async () => {
    const deps = makeDeps({
      captureBurst: vi
        .fn()
        .mockResolvedValueOnce(burst("raiz", [callbackBtn("ver status")]))
        // "recibo"/"sucesso" disparam o scanner pós-clique, mas nem o
        // texto nem o rótulo do botão batem em PAYMENT_KEYWORD_PATTERNS —
        // sem isso o teste estaria testando o achado #6 (correlação com o
        // texto da mensagem) por acidente, não o scanner pós-clique.
        .mockResolvedValueOnce(burst("Recibo gerado com sucesso!", [callbackBtn("ver outro item")]))
        .mockResolvedValueOnce(burst("outro item aqui")), // resposta do clique em "ver outro item"
    });
    await new BotExplorer(deps, cfg()).run();

    expect(deps.persisted[1].paymentConfirmationSuspected).toBe(true);
    // segue explorando: o botão do nó suspeito ainda foi enfileirado/clicado.
    expect(deps.clickButton).toHaveBeenCalledTimes(2);
  });

  it("resume: botão já com filho persistido não é clicado de novo (idempotência, achado #8)", async () => {
    const existing: ExistingNode[] = [
      {
        id: "root",
        fingerprint: "fp-root",
        status: "explored",
        parentNodeId: null,
        triggeredByButtonId: null,
        depth: 0,
        messages: [
          {
            seq: 0,
            rawMsgId: 1,
            text: "raiz",
            entities: [],
            mediaKind: "none",
            mediaPublicUrl: null,
            buttons: [
              { id: "b0_0", kind: "callback", label: "a", url: null, data: Buffer.from("da").toString("base64"), skip: false, skipReason: null, paymentDomainMatch: false },
              { id: "b0_1", kind: "callback", label: "b", url: null, data: Buffer.from("db").toString("base64"), skip: false, skipReason: null, paymentDomainMatch: false },
            ],
          },
        ],
      },
      {
        id: "childA",
        fingerprint: "fp-a",
        status: "explored",
        parentNodeId: "root",
        triggeredByButtonId: "b0_0",
        depth: 1,
        messages: [{ seq: 0, rawMsgId: 2, text: "filho a", entities: [], mediaKind: "none", mediaPublicUrl: null, buttons: [] }],
      },
    ];
    const deps = makeDeps({
      loadExistingNodes: vi.fn(async () => existing),
      captureBurst: vi.fn().mockResolvedValueOnce(burst("filho b")),
    });
    await new BotExplorer(deps, cfg()).run();

    // /start NÃO roda de novo (raiz já existe); só o botão "b" (sem filho
    // ainda) é clicado — "a" já tem childA persistido, não repete.
    expect(deps.sendStart).not.toHaveBeenCalled();
    expect(deps.clickButton).toHaveBeenCalledTimes(1);
    expect(deps.clickButton).toHaveBeenCalledWith(1, Buffer.from("db"));
  });

  it("flood (ou qualquer erro) durante o clique propaga sem ser engolido", async () => {
    const deps = makeDeps({
      captureBurst: vi.fn().mockResolvedValueOnce(burst("raiz", [callbackBtn("ir")])),
      clickButton: vi.fn(async () => {
        throw new Error("FLOOD_WAIT_30");
      }),
    });
    await expect(new BotExplorer(deps, cfg()).run()).rejects.toThrow("FLOOD_WAIT_30");
  });

  it("job pausado/apagado entre itens: para o loop sem processar o resto da fila", async () => {
    let calls = 0;
    const deps = makeDeps({
      captureBurst: vi.fn().mockResolvedValueOnce(burst("raiz", [callbackBtn("a"), callbackBtn("b")])),
      getStatus: vi.fn(async () => (++calls > 1 ? "paused" : "exploring")),
    });
    await new BotExplorer(deps, cfg()).run();

    expect(deps.clickButton).not.toHaveBeenCalled();
  });

  it("mídia é baixada/re-hospedada só depois de confirmar que NÃO é duplicata", async () => {
    const deps = makeDeps({
      captureBurst: vi
        .fn()
        .mockResolvedValueOnce([
          { rawMsgId: 1, text: "raiz com foto", entities: undefined, mediaKind: "photo", media: { x: 1 }, fileName: "a.jpg", rawButtons: [] },
        ]),
      rehostMedia: vi.fn(async () => "https://cdn/x.jpg"),
    });
    await new BotExplorer(deps, cfg()).run();

    expect(deps.rehostMedia).toHaveBeenCalledTimes(1);
    expect(deps.persisted[0].messages[0].mediaPublicUrl).toBe("https://cdn/x.jpg");
  });
});
