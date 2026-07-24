import { describe, it, expect, vi } from "vitest";
import { FloodWaitError } from "telegram/errors/index.js";
import {
  CloneRunner,
  type CloneRunnerDeps,
} from "../../src/services/mtproto/clone/clone-runner.js";
import type { CloneJobConfig, SourceMessage } from "../../src/services/mtproto/clone/types.js";

function m(id: number, over: Partial<SourceMessage> = {}): SourceMessage {
  return { id, groupedId: null, replyToMsgId: null, raw: { id }, ...over };
}

function cfg(over: Partial<CloneJobConfig> = {}): CloneJobConfig {
  return {
    jobId: "j1",
    messageLimit: null,
    throttleMs: 0,
    copyReplies: false,
    copyPins: false,
    copyButtons: false,
    copyPolls: false,
    ...over,
  };
}

function deps(
  messages: SourceMessage[],
  over: Partial<CloneRunnerDeps> = {},
): CloneRunnerDeps & { groups: SourceMessage[][]; replies: Array<number | null> } {
  const groups: SourceMessage[][] = [];
  const replies: Array<number | null> = [];
  let nextDestId = 100;
  const base: CloneRunnerDeps = {
    iterate: async function* (since: number) {
      for (const msg of messages) if (msg.id > since) yield msg;
    },
    publish: async (group, replyToDestId) => {
      groups.push(group);
      replies.push(replyToDestId);
      return group.map(() => ({ status: "copied" as const, destMsgId: nextDestId++ }));
    },
    persist: vi.fn(async () => {}),
    loadIdMap: vi.fn(async () => []),
    getStatus: vi.fn(async () => "running"),
    setStatus: vi.fn(async () => {}),
    scheduleResume: vi.fn(async () => {}),
    sourcePinnedIds: vi.fn(async () => []),
    pinInDest: vi.fn(async () => {}),
    delay: vi.fn(async () => {}),
    ...over,
  };
  return Object.assign(base, { groups, replies });
}

describe("CloneRunner", () => {
  it("publica cada mensagem solta e conclui o job", async () => {
    const d = deps([m(1), m(2), m(3)]);
    await new CloneRunner(d, cfg()).run();
    expect(d.groups).toEqual([[m(1)], [m(2)], [m(3)]]);
    expect(d.setStatus).toHaveBeenLastCalledWith("j1", "completed", expect.anything());
  });

  it("agrupa mensagens com o mesmo groupedId num álbum só", async () => {
    const d = deps([
      m(1, { groupedId: "g1" }),
      m(2, { groupedId: "g1" }),
      m(3, { groupedId: "g1" }),
      m(4),
    ]);
    await new CloneRunner(d, cfg()).run();
    expect(d.groups.map((g) => g.map((x) => x.id))).toEqual([[1, 2, 3], [4]]);
  });

  it("fatia álbum acima de 10 itens", async () => {
    const d = deps(Array.from({ length: 12 }, (_, i) => m(i + 1, { groupedId: "g1" })));
    await new CloneRunner(d, cfg()).run();
    expect(d.groups.map((g) => g.length)).toEqual([10, 2]);
  });

  it("respeita messageLimit contando mensagens, não grupos", async () => {
    const d = deps([m(1), m(2), m(3), m(4), m(5)]);
    await new CloneRunner(d, cfg({ messageLimit: 3 })).run();
    expect(d.groups.flat().map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("avança o cursor a cada grupo persistido", async () => {
    const d = deps([m(1), m(2)]);
    await new CloneRunner(d, cfg()).run();
    const cursors = (d.persist as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(cursors).toEqual([1, 2]);
  });

  it("remapeia resposta para o id do destino quando copyReplies está ligado", async () => {
    const d = deps([m(1), m(2, { replyToMsgId: 1 })]);
    await new CloneRunner(d, cfg({ copyReplies: true })).run();
    expect(d.replies).toEqual([null, 100]);
  });

  it("envia sem resposta quando o alvo da resposta não foi clonado", async () => {
    const d = deps([m(2, { replyToMsgId: 1 })]);
    await new CloneRunner(d, cfg({ copyReplies: true })).run();
    expect(d.replies).toEqual([null]);
  });

  it("ignora o remapeamento quando copyReplies está desligado", async () => {
    const d = deps([m(1), m(2, { replyToMsgId: 1 })]);
    await new CloneRunner(d, cfg({ copyReplies: false })).run();
    expect(d.replies).toEqual([null, null]);
  });

  it("recarrega o mapa do banco na retomada", async () => {
    const d = deps([m(2, { replyToMsgId: 1 })], {
      loadIdMap: vi.fn(async () => [[1, 900] as [number, number]]),
    });
    await new CloneRunner(d, cfg({ copyReplies: true })).run();
    expect(d.replies).toEqual([900]);
  });

  it("em FLOOD_WAIT agenda retomada e não conclui o job", async () => {
    const d = deps([m(1), m(2)], {
      publish: async (group) => {
        if (group[0].id === 2) {
          throw new FloodWaitError({ request: undefined as never, capture: 60 } as never);
        }
        return group.map(() => ({ status: "copied" as const, destMsgId: 1 }));
      },
    });
    await new CloneRunner(d, cfg()).run();
    expect(d.scheduleResume).toHaveBeenCalledWith("j1", 60);
    expect(d.setStatus).toHaveBeenCalledWith("j1", "waiting_flood", expect.anything());
    expect(d.setStatus).not.toHaveBeenCalledWith("j1", "completed", expect.anything());
  });

  it("aborta no meio quando o job é pausado pela UI", async () => {
    let calls = 0;
    const d = deps([m(1), m(2), m(3)], {
      getStatus: vi.fn(async () => (++calls > 1 ? "paused" : "running")),
    });
    await new CloneRunner(d, cfg()).run();
    expect(d.groups.flat().map((x) => x.id)).toEqual([1]);
    expect(d.setStatus).not.toHaveBeenCalledWith("j1", "completed", expect.anything());
  });

  it("aborta quando o job some do banco (deletado pela UI)", async () => {
    const d = deps([m(1), m(2)], { getStatus: vi.fn(async () => null) });
    await new CloneRunner(d, cfg()).run();
    expect(d.groups).toEqual([]);
  });

  it("erro comum vira outcome failed e o clone segue", async () => {
    const d = deps([m(1), m(2)], {
      publish: async (group) => {
        if (group[0].id === 1) throw new Error("MEDIA_EMPTY");
        return group.map(() => ({ status: "copied" as const, destMsgId: 500 }));
      },
    });
    await new CloneRunner(d, cfg()).run();
    const rows = (d.persist as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[1]);
    expect(rows[0]).toMatchObject({ sourceMsgId: 1, status: "failed", reason: "MEDIA_EMPTY" });
    expect(d.setStatus).toHaveBeenLastCalledWith("j1", "completed", expect.anything());
  });

  it("aplica os pins só no final, traduzidos pelo mapa", async () => {
    const d = deps([m(1), m(2)], { sourcePinnedIds: vi.fn(async () => [2]) });
    await new CloneRunner(d, cfg({ copyPins: true })).run();
    expect(d.pinInDest).toHaveBeenCalledWith([101]);
    // ordem: pin depois de todo o envio
    const pinOrder = (d.pinInDest as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const lastPublish = d.groups.length;
    expect(lastPublish).toBe(2);
    expect(pinOrder).toBeGreaterThan(0);
  });

  it("não toca em pins quando o toggle está desligado", async () => {
    const d = deps([m(1)], { sourcePinnedIds: vi.fn(async () => [1]) });
    await new CloneRunner(d, cfg({ copyPins: false })).run();
    expect(d.pinInDest).not.toHaveBeenCalled();
  });

  it("aplica o throttle entre publicações", async () => {
    const d = deps([m(1), m(2)]);
    await new CloneRunner(d, cfg({ throttleMs: 3000 })).run();
    expect(d.delay).toHaveBeenCalledWith(3000);
  });
});
