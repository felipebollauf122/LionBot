import { describe, it, expect, vi } from "vitest";
import { ensureBotAccess } from "../../src/services/mtproto/ensure-bot-access.js";

function deps(over: Record<string, unknown> = {}) {
  return {
    promote: vi.fn(async () => {}),
    ...over,
  } as Parameters<typeof ensureBotAccess>[0];
}

const input = {
  channelId: "123",
  accessHash: "456",
  botUsername: "meubot",
};

describe("ensureBotAccess", () => {
  it("promoção bem-sucedida devolve ok", async () => {
    const d = deps();
    expect(await ensureBotAccess(d, input)).toEqual({ ok: true });
    expect(d.promote).toHaveBeenCalledWith("123", "456", "meubot");
  });

  it("bot já admin (NOT_MODIFIED) conta como sucesso", async () => {
    // promoteBotToAdmin já tolera USER_ALREADY_PARTICIPANT e USER_BOT por
    // dentro; NOT_MODIFIED sobe, e repromover quem já é admin é sucesso.
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("400: NOT_MODIFIED");
      }),
    });
    expect(await ensureBotAccess(d, input)).toEqual({ ok: true });
  });

  it("privacidade de grupo ligada no bot vira erro acionável", async () => {
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("400: BOT_GROUPS_BLOCKED");
      }),
    });
    const r = await ensureBotAccess(d, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/BotFather/i);
  });

  it("conta sem direito de promover vira erro acionável", async () => {
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("403: RIGHT_FORBIDDEN");
      }),
    });
    const r = await ensureBotAccess(d, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/administrador/i);
  });

  it("erro desconhecido não é engolido: volta com a mensagem original", async () => {
    const d = deps({
      promote: vi.fn(async () => {
        throw new Error("500: ALGO_ESTRANHO");
      }),
    });
    const r = await ensureBotAccess(d, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ALGO_ESTRANHO");
  });
});
