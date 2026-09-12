import { describe, it, expect } from "vitest";
import { buildGlobalTargetRows } from "../../src/services/mtproto/global-targets.js";

const dialog = (over: Partial<Parameters<typeof buildGlobalTargetRows>[1][number]> = {}) => ({
  id: "d1",
  account_id: "acc1",
  title: "Grupo X",
  username: null,
  write_block: null,
  send_refusal: null,
  ...over,
});

describe("buildGlobalTargetRows", () => {
  it("dialog sem bloqueio vira alvo pending pinned na conta dona", () => {
    expect(buildGlobalTargetRows("c1", [dialog({ username: "grupox" })])).toEqual([
      {
        campaign_id: "c1",
        target_identifier: "grupox",
        target_type: "username",
        status: "pending",
        error_message: null,
        dialog_id: "d1",
        account_id: "acc1",
      },
    ]);
  });

  it("sem username usa o título; sem título usa o id do dialog", () => {
    expect(buildGlobalTargetRows("c1", [dialog()])[0].target_identifier).toBe("Grupo X");
    expect(buildGlobalTargetRows("c1", [dialog({ title: null })])[0].target_identifier).toBe("d1");
  });

  it("bloqueio visto na sincronização vira alvo skipped com o código", () => {
    const [row] = buildGlobalTargetRows("c1", [dialog({ write_block: "CHAT_WRITE_FORBIDDEN" })]);
    expect(row.status).toBe("skipped");
    expect(row.error_message).toBe("CHAT_WRITE_FORBIDDEN");
  });

  it("recusa real do envio (send_refusal) vence o bloqueio da sincronização", () => {
    const [row] = buildGlobalTargetRows("c1", [
      dialog({ write_block: "CHAT_WRITE_FORBIDDEN", send_refusal: "USER_BANNED_IN_CHANNEL" }),
    ]);
    expect(row.status).toBe("skipped");
    expect(row.error_message).toBe("USER_BANNED_IN_CHANNEL");
  });

  it("mantém a ordem e mistura pending/skipped", () => {
    const rows = buildGlobalTargetRows("c1", [
      dialog({ id: "a" }),
      dialog({ id: "b", write_block: "CHAT_ADMIN_REQUIRED" }),
      dialog({ id: "c" }),
    ]);
    expect(rows.map((r) => [r.dialog_id, r.status])).toEqual([
      ["a", "pending"],
      ["b", "skipped"],
      ["c", "pending"],
    ]);
  });
});
