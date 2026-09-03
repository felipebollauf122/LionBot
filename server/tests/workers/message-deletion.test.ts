import { describe, it, expect, vi } from "vitest";
import {
  runMessageDeletion,
  processOverdueDeletions,
  OVERDUE_GRACE_SECONDS,
} from "../../src/workers/message-deletion.js";

/** Query builder encadeável do PostgREST, o suficiente pro que o módulo usa. */
function makeDb(pendingRows: Record<string, unknown>[] = []) {
  const updates: Record<string, unknown>[] = [];
  const selectFilters: Record<string, unknown> = {};

  return {
    updates,
    selectFilters,
    from() {
      return {
        update(values: Record<string, unknown>) {
          const applied: Record<string, unknown> = { values };
          const chain = {
            eq(col: string, val: unknown) {
              applied[col] = val;
              return chain;
            },
            then(resolve: (r: unknown) => void) {
              updates.push(applied);
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
        select() {
          const chain = {
            eq(col: string, val: unknown) { selectFilters[col] = val; return chain; },
            lte(col: string, val: unknown) { selectFilters[`lte:${col}`] = val; return chain; },
            order(col: string, opts: { ascending: boolean }) {
              selectFilters.order = `${col}:${opts.ascending ? "asc" : "desc"}`;
              return chain;
            },
            limit(n: number) {
              selectFilters.limit = n;
              return Promise.resolve({ data: pendingRows, error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

describe("runMessageDeletion", () => {
  it("marca a linha como deletada quando o Telegram confirma", async () => {
    const db = makeDb();
    const deleteMessage = vi.fn().mockResolvedValue(true);

    await runMessageDeletion({ db: db as never, deleteMessage }, {
      queueRowId: "row-1", botToken: "tok", chatId: 55, messageId: 900,
    });

    expect(deleteMessage).toHaveBeenCalledWith("tok", 55, 900);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].values).toMatchObject({ status: "deleted" });
    expect(db.updates[0].id).toBe("row-1");
  });

  it("marca como falha quando o Telegram recusa", async () => {
    const db = makeDb();

    await runMessageDeletion({ db: db as never, deleteMessage: vi.fn().mockResolvedValue(false) }, {
      queueRowId: "row-1", botToken: "tok", chatId: 55, messageId: 900,
    });

    expect(db.updates[0].values).toMatchObject({ status: "failed" });
  });

  it("só rebaixa para falha uma linha ainda pendente — não sobrescreve um 'deleted' de outra rodada", async () => {
    const db = makeDb();

    await runMessageDeletion({ db: db as never, deleteMessage: vi.fn().mockResolvedValue(false) }, {
      queueRowId: "row-1", botToken: "tok", chatId: 55, messageId: 900,
    });

    expect(db.updates[0].status).toBe("pending");
  });
});

describe("processOverdueDeletions (rede de segurança)", () => {
  it("pega as mais antigas primeiro, pra backlog não travar as novas", async () => {
    const db = makeDb([]);

    await processOverdueDeletions({ db: db as never, deleteMessage: vi.fn() });

    expect(db.selectFilters.order).toBe("delete_at:asc");
    expect(db.selectFilters.status).toBe("pending");
  });

  it("ignora o que venceu agora — esse ainda é do job agendado", async () => {
    const db = makeDb([]);
    const before = Date.now();

    await processOverdueDeletions({ db: db as never, deleteMessage: vi.fn() });

    const cutoff = new Date(String(db.selectFilters["lte:delete_at"])).getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(OVERDUE_GRACE_SECONDS * 1000 - 50);
  });

  it("apaga o que ficou para trás e devolve quantas processou", async () => {
    const db = makeDb([
      { id: "a", bot_token: "t1", chat_id: 1, message_id: 10 },
      { id: "b", bot_token: "t2", chat_id: 2, message_id: 20 },
    ]);
    const deleteMessage = vi.fn().mockResolvedValue(true);

    const count = await processOverdueDeletions({ db: db as never, deleteMessage });

    expect(count).toBe(2);
    expect(deleteMessage).toHaveBeenCalledWith("t1", 1, 10);
    expect(deleteMessage).toHaveBeenCalledWith("t2", 2, 20);
  });

  it("não faz nada quando a fila está vazia", async () => {
    const deleteMessage = vi.fn();
    const count = await processOverdueDeletions({ db: makeDb([]) as never, deleteMessage });

    expect(count).toBe(0);
    expect(deleteMessage).not.toHaveBeenCalled();
  });
});

describe("diagnóstico do atraso real", () => {
  it("mede quanto a deleção atrasou em relação ao alvo e registra no log", async () => {
    const db = makeDb();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runMessageDeletion({ db: db as never, deleteMessage: vi.fn().mockResolvedValue(true) }, {
      queueRowId: "row-1",
      botToken: "tok",
      chatId: 55,
      messageId: 900,
      // Enviada há 12s, com alvo de 10s: atrasou 2s.
      sentAt: Date.now() - 12_000,
      targetSeconds: 10,
    });

    const linha = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("row-1"));
    expect(linha).toMatch(/alvo 10s/);
    expect(linha).toMatch(/real 12(\.\d)?s/);
    log.mockRestore();
  });

  it("não quebra quando o job foi agendado por uma versão antiga, sem os campos de medição", async () => {
    const db = makeDb();

    await runMessageDeletion({ db: db as never, deleteMessage: vi.fn().mockResolvedValue(true) }, {
      queueRowId: "row-1", botToken: "tok", chatId: 55, messageId: 900,
    });

    expect(db.updates[0].values).toMatchObject({ status: "deleted" });
  });
});
