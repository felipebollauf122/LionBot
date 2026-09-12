import { describe, it, expect } from "vitest";
import {
  channelWriteBlock,
  chatWriteBlock,
} from "../../src/services/mtproto/dialog-writability.js";

describe("channelWriteBlock (Api.Channel: canal broadcast ou supergrupo)", () => {
  it("canal broadcast onde a conta só assina: só admin posta", () => {
    expect(channelWriteBlock({ broadcast: true })).toBe("CHAT_ADMIN_REQUIRED");
  });

  it("canal broadcast do dono ou de admin com post_messages: pode", () => {
    expect(channelWriteBlock({ broadcast: true, creator: true })).toBeNull();
    expect(channelWriteBlock({ broadcast: true, adminRights: { postMessages: true } })).toBeNull();
  });

  it("canal broadcast com admin SEM post_messages: não pode", () => {
    expect(channelWriteBlock({ broadcast: true, adminRights: { postMessages: false } })).toBe(
      "CHAT_ADMIN_REQUIRED",
    );
  });

  it("supergrupo onde só participa, sem restrição: pode", () => {
    expect(channelWriteBlock({ megagroup: true })).toBeNull();
  });

  it("conta saiu (ou foi removida) do grupo: não pode", () => {
    expect(channelWriteBlock({ megagroup: true, left: true })).toBe("LEFT_CHAT");
    expect(channelWriteBlock({ broadcast: true, creator: true, left: true })).toBe("LEFT_CHAT");
  });

  it("chat restrito pelo Telegram: não pode, nem admin", () => {
    expect(channelWriteBlock({ megagroup: true, restricted: true, creator: true })).toBe(
      "CHAT_RESTRICTED",
    );
  });

  it("conta silenciada no grupo (banned_rights da própria conta): não pode", () => {
    expect(channelWriteBlock({ megagroup: true, bannedRights: { sendMessages: true } })).toBe(
      "CHAT_WRITE_FORBIDDEN",
    );
    expect(channelWriteBlock({ megagroup: true, bannedRights: { sendPlain: true } })).toBe(
      "CHAT_SEND_PLAIN_FORBIDDEN",
    );
  });

  it("grupo com 'Enviar mensagens' desligado nas permissões padrão: membro não pode, admin pode", () => {
    expect(channelWriteBlock({ megagroup: true, defaultBannedRights: { sendMessages: true } })).toBe(
      "CHAT_WRITE_FORBIDDEN",
    );
    expect(
      channelWriteBlock({ megagroup: true, creator: true, defaultBannedRights: { sendMessages: true } }),
    ).toBeNull();
    expect(
      channelWriteBlock({
        megagroup: true,
        adminRights: { postMessages: false },
        defaultBannedRights: { sendMessages: true },
      }),
    ).toBeNull();
  });

  it("grupo que recusa só texto puro nas permissões padrão: membro não pode", () => {
    expect(channelWriteBlock({ megagroup: true, defaultBannedRights: { sendPlain: true } })).toBe(
      "CHAT_SEND_PLAIN_FORBIDDEN",
    );
  });
});

describe("chatWriteBlock (Api.Chat: grupo legado)", () => {
  it("membro comum sem restrição: pode", () => {
    expect(chatWriteBlock({})).toBeNull();
  });

  it("grupo desativado (migrou pra supergrupo) ou que a conta saiu: não pode", () => {
    expect(chatWriteBlock({ deactivated: true })).toBe("CHAT_DEACTIVATED");
    expect(chatWriteBlock({ left: true })).toBe("LEFT_CHAT");
  });

  it("permissão padrão sem 'Enviar mensagens': membro não pode, dono pode", () => {
    expect(chatWriteBlock({ defaultBannedRights: { sendMessages: true } })).toBe(
      "CHAT_WRITE_FORBIDDEN",
    );
    expect(chatWriteBlock({ creator: true, defaultBannedRights: { sendMessages: true } })).toBeNull();
    expect(
      chatWriteBlock({ adminRights: { postMessages: false }, defaultBannedRights: { sendMessages: true } }),
    ).toBeNull();
  });
});
