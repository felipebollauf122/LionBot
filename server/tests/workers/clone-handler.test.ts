import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCloneRun } from "../../src/workers/clone-handler.js";

const h = vi.hoisted(() => ({
  job: {} as Record<string, unknown>,
  failDest: false,
  writes: [] as Array<Record<string, unknown>>,
  floor: vi.fn(async () => 500),
  offsets: [] as number[],
  create: vi.fn(async () => ({ channelId: "77", accessHash: "88" })),
  promote: vi.fn(async () => {}),
  publish: vi.fn(async () => []),
  enqueue: vi.fn(async () => {}),
  pin: vi.fn(async () => {}),
  mapPages: [] as Array<Array<Record<string, unknown>>>,
}));
vi.mock("node:fs/promises", () => ({ rm: vi.fn(async () => {}) }));
vi.mock("../../src/queue-mtproto.js", () => ({ enqueueMtproto: h.enqueue }));
vi.mock("../../src/services/mtproto/client.js", () => ({ MtprotoClient: class {
  connect = async () => {};
  disconnect = async () => {};
  createChannel = h.create;
  promoteBotToAdmin = h.promote;
  exportChannelInvite = async () => "https://t.me/+test";
} }));
vi.mock("../../src/services/mtproto/clone/source-reader.js", () => ({
  READ_THROTTLE_MS: 0,
  SourceReader: class {
    floorForLastN = h.floor;
    pinnedIds = async () => [1];
    isForum = async () => false;
    hasNoForwards = async () => false;
    historySource() {
      return { fetch: async function* (offset: number) { h.offsets.push(offset); }, delay: async () => {} };
    }
  },
}));
vi.mock("../../src/services/mtproto/clone/bot-client.js", () => ({ CompanionBot: class {
  static destChatIdFromChannelId() { return "-10077"; }
  disconnect = async () => {};
  pin = h.pin;
} }));
vi.mock("../../src/services/mtproto/clone/publish-router.js", () => ({
  chooseStrategy: () => "batch", createPublisher: () => h.publish, MAX_FILE_BYTES: 1024,
}));
vi.mock("../../src/db.js", () => ({ supabase: {
  from(table: string) {
    let payload: Record<string, unknown> | undefined;
    let columns = "*";
    const resolve = async () => {
      if (table === "clone_jobs") {
        if (payload) {
          h.writes.push(payload);
          if (h.failDest && payload.dest_channel_id) return { data: null, error: { message: "DEST_DB_ERROR" } };
          Object.assign(h.job, payload);
        }
        return { data: columns === "id" ? { id: h.job.id } : { ...h.job }, error: null };
      }
      if (table === "mtproto_accounts") return { data: { id: "a1", session_string: "fake", status: "active" }, error: null };
      if (table === "automation_bots") return { data: { token: "fake", username: "fake_bot", status: "active" }, error: null };
      if (table === "clone_message_map") return { data: h.mapPages.shift() ?? [], error: null };
      throw new Error(`unexpected table ${table}`);
    };
    const q = {
      select: (value: string) => { columns = value; return q; },
      update: (value: Record<string, unknown>) => { payload = value; return q; },
      eq: () => q, in: () => q, or: () => q, gt: () => q, order: () => q, limit: () => q,
      single: () => q, maybeSingle: () => q,
      throwOnError: async () => { const result = await resolve(); if (result.error) throw new Error(result.error.message); return result; },
      then: (ok: (value: unknown) => unknown, fail?: (err: unknown) => unknown) => resolve().then(ok, fail),
    };
    return q;
  },
} }));

beforeEach(() => {
  vi.clearAllMocks();
  h.job = {
    id: "j1", status: "running", tenant_id: "t1", account_id: "a1",
    source_peer_id: "11", source_peer_type: "channel", source_peer_access_hash: "22",
    dest_channel_id: "77", dest_access_hash: "88", dest_invite_link: "https://t.me/+test",
    dest_kind: "broadcast", dest_title: "Clone", copy_identity: false,
    mode: "live", message_limit: 10, throttle_ms: 0, cursor_source_msg_id: 0,
  };
  h.failDest = false;
  h.writes = [];
  h.offsets = [];
  h.mapPages = [];
});

describe("clone worker wiring (no network)", () => {
  it("fixa o piso antes de ler e nao recalcula na retomada", async () => {
    await handleCloneRun("j1");
    expect(h.floor).toHaveBeenCalledTimes(1);
    expect(h.job.cursor_source_msg_id).toBe(499);
    expect(h.offsets).toEqual([499]);
    h.job.status = "waiting_flood";
    await handleCloneRun("j1");
    expect(h.floor).toHaveBeenCalledTimes(1);
    expect(h.offsets).toEqual([499, 499]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("usa cursor persistido mesmo quando nao existe mensagem copiada", async () => {
    h.job.cursor_source_msg_id = 620;
    await handleCloneRun("j1");
    expect(h.floor).not.toHaveBeenCalled();
    expect(h.offsets).toEqual([620]);
  });

  it("recusa de fixacao nao derruba uma clonagem ja copiada", async () => {
    // O conteudo ja foi copiado; fixar e acessorio. Um bot sem permissao de
    // fixar (ou uma mensagem apagada no destino) nao pode transformar uma
    // clonagem inteira em "failed".
    h.job.copy_pins = true;
    h.job.cursor_source_msg_id = 620;
    h.mapPages = [[{ source_msg_id: 1, dest_msg_id: 900, status: "copied" }]];
    h.pin.mockRejectedValueOnce(new Error("CHAT_ADMIN_REQUIRED"));
    await handleCloneRun("j1");
    expect(h.pin).toHaveBeenCalledWith(900);
    expect(h.job.status).toBe("completed");
  });

  it("falha antes de promover/publicar se o destino criado nao foi salvo", async () => {
    h.job.dest_channel_id = null;
    h.failDest = true;
    await handleCloneRun("j1");
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.promote).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.job.status).toBe("failed");
    expect(h.job.last_error).toBe("DEST_DB_ERROR");
    expect(h.job.processing_started_at).toBeNull();
  });
});
