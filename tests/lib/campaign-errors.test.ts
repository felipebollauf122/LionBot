import { describe, it, expect } from "vitest";
import { friendlyCampaignError, targetStatusLabel } from "@/lib/mtproto/campaign-errors";

// O worker grava o erro cru do gramjs em mtproto_targets.error_message
// ("403: CHAT_WRITE_FORBIDDEN (caused by messages.SendMessage)") ou só o
// código (alvo pulado: "CHAT_ADMIN_REQUIRED"). A tela traduz os dois.
describe("friendlyCampaignError", () => {
  it("CHAT_ADMIN_REQUIRED: canal onde a conta não é admin", () => {
    expect(friendlyCampaignError("400: CHAT_ADMIN_REQUIRED (caused by messages.SendMessage)")).toMatch(
      /admin/i,
    );
    expect(friendlyCampaignError("CHAT_ADMIN_REQUIRED")).toMatch(/canal/i);
  });

  it("CHAT_WRITE_FORBIDDEN: sem permissão de escrever ali", () => {
    expect(friendlyCampaignError("403: CHAT_WRITE_FORBIDDEN (caused by messages.SendMessage)")).toMatch(
      /permiss/i,
    );
  });

  it("USER_BANNED_IN_CHANNEL: conta banida/removida do grupo", () => {
    expect(friendlyCampaignError("USER_BANNED_IN_CHANNEL")).toMatch(/banid|removid/i);
  });

  it("CHAT_RESTRICTED: chat restrito pelo Telegram", () => {
    expect(friendlyCampaignError("CHAT_RESTRICTED")).toMatch(/restri/i);
  });

  it("TOPIC_CLOSED: fórum sem tópico aberto", () => {
    expect(friendlyCampaignError("TOPIC_CLOSED")).toMatch(/tópico/i);
  });

  it("CHANNEL_PRIVATE / LEFT_CHAT / CHAT_DEACTIVATED: a conta não está mais lá", () => {
    expect(friendlyCampaignError("CHANNEL_PRIVATE")).toMatch(/não (está|faz) mais|saiu|removida/i);
    expect(friendlyCampaignError("LEFT_CHAT")).toMatch(/saiu|não (está|faz) mais/i);
    expect(friendlyCampaignError("CHAT_DEACTIVATED")).toMatch(/desativad|migrou/i);
  });

  it("PEER_ID_INVALID / CHANNEL_INVALID: peer que a conta não reconhece — pede sincronizar", () => {
    expect(friendlyCampaignError("PEER_ID_INVALID")).toMatch(/sincroniz/i);
    expect(friendlyCampaignError("CHANNEL_INVALID")).toMatch(/sincroniz/i);
  });

  it("CHAT_SEND_PLAIN_FORBIDDEN: destino não aceita texto puro", () => {
    expect(friendlyCampaignError("CHAT_SEND_PLAIN_FORBIDDEN")).toMatch(/texto/i);
  });

  it("USER_PRIVACY_RESTRICTED / USER_IS_BLOCKED: o contato não recebe desta conta", () => {
    expect(friendlyCampaignError("USER_PRIVACY_RESTRICTED")).toMatch(/privacidade/i);
    expect(friendlyCampaignError("USER_IS_BLOCKED")).toMatch(/bloqueou/i);
  });

  it("invalid_identifier: alvo colado errado", () => {
    expect(friendlyCampaignError("invalid_identifier")).toMatch(/inválido/i);
  });

  it("USERNAME_NOT_OCCUPIED / USERNAME_INVALID: @ não existe", () => {
    expect(friendlyCampaignError("400: USERNAME_NOT_OCCUPIED (caused by contacts.ResolveUsername)")).toMatch(
      /não existe/i,
    );
    expect(friendlyCampaignError("USERNAME_INVALID")).toMatch(/não existe|inválido/i);
  });

  it("PHONE_NOT_ON_TELEGRAM: número sem Telegram", () => {
    expect(friendlyCampaignError("PHONE_NOT_ON_TELEGRAM")).toMatch(/telegram/i);
  });

  it("pinned_account_unavailable: conta dona do alvo indisponível", () => {
    expect(friendlyCampaignError("pinned_account_unavailable")).toMatch(/conta/i);
  });

  it("flood: informa a espera e que retoma sozinho", () => {
    expect(friendlyCampaignError("flood_wait_120s")).toMatch(/120/);
    expect(friendlyCampaignError("A wait of 45 seconds is required (caused by messages.SendMessage)")).toMatch(
      /45/,
    );
  });

  it("PEER_FLOOD: conta limitada por spam", () => {
    expect(friendlyCampaignError("400: PEER_FLOOD (caused by messages.SendMessage)")).toMatch(/spam/i);
  });

  it("sessão morta da conta", () => {
    expect(friendlyCampaignError("401: AUTH_KEY_UNREGISTERED (caused by messages.SendMessage)")).toMatch(
      /reconect/i,
    );
  });

  it("erro desconhecido volta cru; vazio volta null", () => {
    expect(friendlyCampaignError("500: INTERNAL (caused by messages.SendMessage)")).toBe(
      "500: INTERNAL (caused by messages.SendMessage)",
    );
    expect(friendlyCampaignError(null)).toBeNull();
    expect(friendlyCampaignError("")).toBeNull();
  });
});

describe("targetStatusLabel", () => {
  it("traduz os quatro status pra PT", () => {
    expect(targetStatusLabel("sent")).toBe("Enviada");
    expect(targetStatusLabel("failed")).toBe("Falhou");
    expect(targetStatusLabel("skipped")).toBe("Pulado");
    expect(targetStatusLabel("pending")).toBe("Aguardando");
  });

  it("status desconhecido volta como veio", () => {
    expect(targetStatusLabel("weird")).toBe("weird");
  });
});
