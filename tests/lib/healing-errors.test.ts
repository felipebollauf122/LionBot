import { describe, it, expect } from "vitest";
import { friendlyHealingError } from "@/lib/mtproto/healing-errors";

describe("friendlyHealingError", () => {
  it("não inventa texto quando não há erro", () => {
    expect(friendlyHealingError(null)).toBeNull();
    expect(friendlyHealingError("   ")).toBeNull();
  });

  it("devolve o código cru quando não conhece — esconder seria pior", () => {
    expect(friendlyHealingError("codigo_que_nao_existe")).toBe("codigo_que_nao_existe");
  });

  it("explica a queda de plano como assinatura, não como defeito", () => {
    const msg = friendlyHealingError("healing_not_available");
    expect(msg).toMatch(/premium|assinatura/i);
    expect(msg).not.toMatch(/erro|falha/i);
  });

  // O caso perigoso: pode ter sobrado um bot criado no BotFather. Mandar
  // "tente de novo" sem avisar cria um segundo bot e um órfão.
  it("manda conferir o BotFather antes de repetir uma criação de desfecho incerto", () => {
    const msg = friendlyHealingError("creation_outcome_unknown");
    expect(msg).toMatch(/@BotFather/);
    expect(msg).toMatch(/antes de/i);
  });

  it("diz que falta a cópia da identidade, e que ela é feita com a recuperação ligada", () => {
    expect(friendlyHealingError("identity_backup_missing")).toMatch(/cópia|identidade/i);
  });

  it.each(["account_bot_limit", "all_accounts_bot_limit"])("traduz %s como limite de bots da conta", (code) => {
    const msg = friendlyHealingError(code);
    expect(msg).toMatch(/20 bots/);
    expect(msg).toMatch(/outra conta|conecte/i);
  });

  it("traduz conta restrita apontando o @SpamBot", () => {
    expect(friendlyHealingError("account_restricted")).toMatch(/@SpamBot/);
  });

  it.each(["mtproto_session_unavailable", "mtproto_account_changed"])("traduz %s como conta a reconectar", (code) => {
    expect(friendlyHealingError(code)).toMatch(/reconecte|reconectar/i);
  });

  it("traduz a falta de conta conectada apontando onde conectar", () => {
    expect(friendlyHealingError("mtproto_account_unavailable")).toMatch(/Contas Telegram/);
  });

  it("traduz credencial de servidor ausente como problema de configuração, não do usuário", () => {
    const msg = friendlyHealingError("healing_credentials_missing");
    expect(msg).toMatch(/GEMINI_API_KEY|TELEGRAM_API_ID/);
  });

  it.each([
    "botfather_identity_unverified",
    "botfather_name_prompt_changed",
    "botfather_username_prompt_changed",
    "botfather_creation_reply_changed",
    "botfather_select_prompt_changed",
    "botfather_profile_prompt_changed",
    "botfather_profile_update_unconfirmed",
  ])("traduz %s como mudança no BotFather, que para por segurança", (code) => {
    const msg = friendlyHealingError(code);
    expect(msg).toMatch(/BotFather/);
    expect(msg).toMatch(/segurança|parou|suporte/i);
  });

  it("diz que o flood retoma sozinho", () => {
    expect(friendlyHealingError("retry_later")).toMatch(/sozinh[ao]|automaticamente/i);
  });

  it("não trata o token que voltou a funcionar como falha", () => {
    const msg = friendlyHealingError("credential_recovered");
    expect(msg).toMatch(/voltou a funcionar|continua/i);
  });

  it("explica que uma mudança manual no bot cancela a recuperação", () => {
    expect(friendlyHealingError("bot_changed")).toMatch(/cancel/i);
  });

  it("traduz foto de perfil grande demais com o limite explícito", () => {
    expect(friendlyHealingError("profile_photo_too_large")).toMatch(/5 ?MB/i);
  });
});
