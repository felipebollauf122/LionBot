import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyInitData } from "@/lib/social-proof/init-data";

const BOT_TOKEN = "123456:FAKE-TOKEN-PARA-TESTE";

/** Monta um initData assinado do mesmo jeito que o Telegram assina. */
function signed(fields: Record<string, string>): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");

  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const now = new Date("2026-09-01T15:00:00Z");
const authDate = String(Math.floor(now.getTime() / 1000) - 60);

describe("verifyInitData", () => {
  it("aceita initData assinado corretamente", () => {
    const data = signed({
      auth_date: authDate,
      query_id: "AAF",
      user: JSON.stringify({ id: 777, first_name: "Ana" }),
    });

    const out = verifyInitData(data, BOT_TOKEN, { now });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.telegramUserId).toBe(777);
  });

  it("rejeita hash adulterado", () => {
    const data = signed({ auth_date: authDate, user: JSON.stringify({ id: 777 }) });
    const adulterado = data.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64));

    const out = verifyInitData(adulterado, BOT_TOKEN, { now });
    expect(out).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejeita quando um campo foi trocado depois de assinado", () => {
    const data = signed({ auth_date: authDate, user: JSON.stringify({ id: 777 }) });
    const trocado = data.replace("777", "888");

    expect(verifyInitData(trocado, BOT_TOKEN, { now }).ok).toBe(false);
  });

  it("rejeita quando não há hash", () => {
    const out = verifyInitData("auth_date=123&user=%7B%7D", BOT_TOKEN, { now });
    expect(out).toEqual({ ok: false, reason: "missing_hash" });
  });

  it("rejeita string vazia", () => {
    expect(verifyInitData("", BOT_TOKEN, { now })).toEqual({ ok: false, reason: "missing_hash" });
  });

  it("rejeita initData velho demais", () => {
    const velho = String(Math.floor(now.getTime() / 1000) - 60 * 60 * 25);
    const data = signed({ auth_date: velho, user: JSON.stringify({ id: 777 }) });

    const out = verifyInitData(data, BOT_TOKEN, { now, maxAgeSeconds: 86400 });
    expect(out).toEqual({ ok: false, reason: "expired" });
  });

  it("rejeita auth_date ausente", () => {
    const data = signed({ user: JSON.stringify({ id: 777 }) });
    expect(verifyInitData(data, BOT_TOKEN, { now })).toEqual({ ok: false, reason: "malformed" });
  });

  it("aceita sem user e devolve id nulo", () => {
    const data = signed({ auth_date: authDate, query_id: "AAF" });
    const out = verifyInitData(data, BOT_TOKEN, { now });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.telegramUserId).toBeNull();
  });

  it("user com JSON quebrado não derruba a verificação", () => {
    const data = signed({ auth_date: authDate, user: "{isso nao e json" });
    const out = verifyInitData(data, BOT_TOKEN, { now });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.telegramUserId).toBeNull();
  });

  it("rejeita quando o token do bot é outro", () => {
    const data = signed({ auth_date: authDate, user: JSON.stringify({ id: 777 }) });
    expect(verifyInitData(data, "999:OUTRO-TOKEN", { now }).ok).toBe(false);
  });
});
