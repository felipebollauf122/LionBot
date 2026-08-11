import { describe, it, expect, vi } from "vitest";
import { FloodWaitError } from "telegram/errors/index.js";
import { syncTopics, finalizeTopics, type TopicSyncDeps } from "../../src/services/mtproto/clone/topic-sync.js";
import type { CloneTopicMapRow, SourceTopic } from "../../src/services/mtproto/clone/types.js";

function topic(id: number, over: Partial<SourceTopic> = {}): SourceTopic {
  return { id, title: `Tópico ${id}`, iconColor: 0, iconEmojiId: null, closed: false, pinned: false, ...over };
}

function deps(over: Partial<TopicSyncDeps> = {}): TopicSyncDeps & { persisted: CloneTopicMapRow[] } {
  const persisted: CloneTopicMapRow[] = [];
  let nextDestId = 200;
  const base: TopicSyncDeps = {
    listSourceTopics: vi.fn(async () => []),
    createDestTopic: vi.fn(async () => nextDestId++),
    setClosed: vi.fn(async () => {}),
    setPinned: vi.fn(async () => {}),
    loadExisting: vi.fn(async () => []),
    persist: vi.fn(async (_jobId: string, row: CloneTopicMapRow) => {
      persisted.push(row);
    }),
    ...over,
  };
  return Object.assign(base, { persisted });
}

describe("syncTopics", () => {
  it("cria tópicos que faltam, persiste 'copied', devolve mapa pré-semeado com General", async () => {
    const d = deps({ listSourceTopics: vi.fn(async () => [topic(1), topic(10), topic(11)]) });
    const out = await syncTopics(d, { jobId: "j1" });

    expect(d.createDestTopic).toHaveBeenCalledTimes(2); // não conta o General (id 1)
    expect(out.topicMap.get(1)).toBe(1);
    expect(out.topicMap.get(10)).toBe(200);
    expect(out.topicMap.get(11)).toBe(201);
    expect(d.persisted).toEqual([
      { sourceTopicId: 10, destTopicId: 200, title: "Tópico 10", status: "copied", reason: null },
      { sourceTopicId: 11, destTopicId: 201, title: "Tópico 11", status: "copied", reason: null },
    ]);
  });

  it("nunca recria o General (id 1), mesmo se vier na lista da origem", async () => {
    const d = deps({ listSourceTopics: vi.fn(async () => [topic(1)]) });
    await syncTopics(d, { jobId: "j1" });
    expect(d.createDestTopic).not.toHaveBeenCalled();
  });

  it("retomada: tópico já 'copied' não é recriado, mas entra no mapa devolvido", async () => {
    const d = deps({
      listSourceTopics: vi.fn(async () => [topic(10)]),
      loadExisting: vi.fn(async () => [
        { sourceTopicId: 10, destTopicId: 555, title: "Tópico 10", status: "copied", reason: null },
      ]),
    });
    const out = await syncTopics(d, { jobId: "j1" });
    expect(d.createDestTopic).not.toHaveBeenCalled();
    expect(out.topicMap.get(10)).toBe(555);
  });

  it("retomada: tópico 'failed' anterior é retentado (não fica preso pra sempre)", async () => {
    const d = deps({
      listSourceTopics: vi.fn(async () => [topic(10)]),
      loadExisting: vi.fn(async () => [
        { sourceTopicId: 10, destTopicId: null, title: "Tópico 10", status: "failed", reason: "boom" },
      ]),
    });
    const out = await syncTopics(d, { jobId: "j1" });
    expect(d.createDestTopic).toHaveBeenCalledTimes(1);
    expect(out.topicMap.get(10)).toBe(200);
  });

  it("erro não-flood num tópico: persiste 'failed', segue pros outros, tópico some do mapa", async () => {
    const d = deps({
      listSourceTopics: vi.fn(async () => [topic(10), topic(11)]),
      createDestTopic: vi.fn(async (input: { title: string }) => {
        if (input.title === "Tópico 10") throw new Error("RPC_HICCUP");
        return 300;
      }),
    });
    const out = await syncTopics(d, { jobId: "j1" });

    expect(out.topicMap.has(10)).toBe(false);
    expect(out.topicMap.get(11)).toBe(300);
    expect(d.persisted).toContainEqual({
      sourceTopicId: 10,
      destTopicId: null,
      title: "Tópico 10",
      status: "failed",
      reason: "RPC_HICCUP",
    });
  });

  it("FLOOD_WAIT é relançado, não engolido como 'failed' (regressão)", async () => {
    const d = deps({
      listSourceTopics: vi.fn(async () => [topic(10)]),
      createDestTopic: vi.fn(async () => {
        throw new FloodWaitError({ request: undefined as never, capture: 30 } as never);
      }),
    });
    await expect(syncTopics(d, { jobId: "j1" })).rejects.toBeInstanceOf(FloodWaitError);
    expect(d.persisted).toEqual([]);
  });
});

describe("finalizeTopics", () => {
  it("fecha e fixa só os tópicos marcados, ignora General e tópicos não criados", async () => {
    const d = deps();
    const sourceTopics = [
      topic(1, { closed: true, pinned: true }), // General: sempre ignorado
      topic(10, { closed: true }),
      topic(11, { pinned: true }),
      topic(12), // nem closed nem pinned: nenhuma chamada
      topic(13, { closed: true }), // não está no topicMap (falhou na criação)
    ];
    const topicMap = new Map([[1, 1], [10, 500], [11, 501], [12, 502]]);

    await finalizeTopics(d, topicMap, sourceTopics);

    expect(d.setClosed).toHaveBeenCalledTimes(1);
    expect(d.setClosed).toHaveBeenCalledWith(500, true);
    expect(d.setPinned).toHaveBeenCalledTimes(1);
    expect(d.setPinned).toHaveBeenCalledWith(501, true);
  });

  it("falha ao fechar/fixar um tópico não impede os demais (best-effort)", async () => {
    const d = deps({
      setClosed: vi.fn(async (id: number) => {
        if (id === 500) throw new Error("EDIT_FORBIDDEN");
      }),
    });
    const sourceTopics = [topic(10, { closed: true }), topic(11, { closed: true })];
    const topicMap = new Map([[10, 500], [11, 501]]);

    await expect(finalizeTopics(d, topicMap, sourceTopics)).resolves.toBeUndefined();
    expect(d.setClosed).toHaveBeenCalledWith(500, true);
    expect(d.setClosed).toHaveBeenCalledWith(501, true);
  });
});
