import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCloneProgressStore } from "../../src/services/mtproto/clone/progress-store.js";

type Row = { source_msg_id: number; dest_msg_id: number | null; status: string };
function fakeDb(rows: Row[], cursor = 0, fail?: string, cap = 1000) {
  const calls: Array<{ table: string; op: string; after: number }> = [];
  const db = {
    from(table: string) {
      let op = "select";
      let after = 0;
      let payload: unknown;
      const query = {
        select: () => query, eq: () => query, single: () => query,
        order: () => query, limit: () => query,
        gt: (_key: string, value: number) => { after = value; return query; },
        update: (value: unknown) => { op = "update"; payload = value; return query; },
        upsert: (value: unknown) => { op = "upsert"; payload = value; return query; },
        async throwOnError() {
          calls.push({ table, op, after });
          if (fail === `${table}:${op}` || (fail === "page2" && after > 0)) throw new Error("DB_ERROR");
          if (op === "update") cursor = (payload as { cursor_source_msg_id: number }).cursor_source_msg_id;
          if (op === "upsert") rows.push(...payload as Row[]);
          return { data: table === "clone_jobs" ? { id: "j1", cursor_source_msg_id: cursor }
            : rows.filter((row) => row.source_msg_id > after).sort((a, b) => a.source_msg_id - b.source_msg_id).slice(0, cap) };
        },
      };
      return query;
    },
  };
  return { store: createCloneProgressStore(db as unknown as SupabaseClient, "j1"), calls };
}

describe("clone progress persistence", () => {
  it("carrega mais de 1000 vinculos mesmo com limite menor imposto pelo servidor", async () => {
    const rows: Row[] = Array.from({ length: 1501 }, (_, i) => ({ source_msg_id: i + 1, dest_msg_id: i + 10000, status: "copied" }));
    rows.push({ source_msg_id: 1502, dest_msg_id: null, status: "skipped" });
    rows.push({ source_msg_id: 1503, dest_msg_id: null, status: "failed" });
    const { store, calls } = fakeDb(rows, 100, undefined, 400);
    const loaded = await store.load();
    expect(loaded.cursor).toBe(1503);
    expect(loaded.idMap).toHaveLength(1501);
    expect(new Map(loaded.idMap).get(1501)).toBe(11500);
    expect(loaded.counters).toEqual({ copied: 1501, skipped: 1, failed: 1, seen: 1503 });
    expect(calls.filter((c) => c.table === "clone_message_map").map((c) => c.after)).toEqual([0, 400, 800, 1200, 1503]);
  });

  it("preserva o piso inicial mesmo antes de existir mensagem processada", async () => {
    const { store } = fakeDb([]);
    await store.saveCursor(499);
    expect((await store.load()).cursor).toBe(499);
  });

  it.each(["clone_jobs:select", "clone_message_map:select", "page2"])("falha de leitura %s nao vira estado vazio", async (fail) => {
    const { store } = fakeDb([{ source_msg_id: 1, dest_msg_id: 2, status: "copied" }], 0, fail);
    await expect(store.load()).rejects.toThrow("DB_ERROR");
  });

  const row = { sourceMsgId: 7, destMsgId: 90, groupedId: null, status: "copied" as const, reason: null };
  it("nao avanca cursor quando o upsert falha", async () => {
    const { store, calls } = fakeDb([], 0, "clone_message_map:upsert");
    await expect(store.persist([row], 7)).rejects.toThrow("DB_ERROR");
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("recupera pelo mapa se a escrita do cursor falha depois do upsert", async () => {
    const { store } = fakeDb([], 0, "clone_jobs:update");
    await expect(store.persist([row], 7)).rejects.toThrow("DB_ERROR");
    const resume = await store.load();
    expect(resume.cursor).toBe(7);
    expect(resume.idMap).toEqual([[7, 90]]);
    expect(resume.counters.copied).toBe(1);
  });
});
