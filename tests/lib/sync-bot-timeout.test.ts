import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncBotFromTelegram } from "@/lib/actions/sync-bot-actions";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.update = () => ({ eq: async () => ({ error: null }) });
      q.single = async () => ({
        data: { id: "bot-1", telegram_token: "123:ABC", tenant_id: "user-1" },
      });
      return q;
    },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      listBuckets: async () => ({ data: [{ id: "media" }] }),
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://x/y.jpg" } }),
      }),
    },
  }),
}));
vi.mock("@/lib/actions/admin-actions", () => ({ isAdmin: async () => false }));
vi.mock("nanoid", () => ({ nanoid: () => "abc123" }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("syncBotFromTelegram — não pendurar o formulário", () => {
  // Esta action roda DEPOIS do insert, com o spinner do formulário na tela.
  // Sem timeout, uma chamada pendurada ao Telegram deixava "criar bot" parado
  // sem fim — e a pessoa reenviava, achando que tinha morrido.
  it("põe prazo em toda chamada ao Telegram", async () => {
    const chamadas = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true, result: { first_name: "Loja", id: 7 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", chamadas);

    await syncBotFromTelegram("bot-1");

    expect(chamadas).toHaveBeenCalled();
    for (const [, init] of chamadas.mock.calls) {
      expect(init?.signal).toBeDefined();
    }
  });

  it("estoura o prazo como falha tratada, não como exceção solta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      }),
    );
    await expect(syncBotFromTelegram("bot-1")).resolves.toMatchObject({ ok: false });
  });
});
