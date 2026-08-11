import { describe, it, expect, vi } from "vitest";
import {
  deriveDestKind,
  ensureDestination,
  type DestBuilderDeps,
} from "../../src/services/mtproto/clone/dest-builder.js";

function deps(over: Partial<DestBuilderDeps> = {}): DestBuilderDeps {
  return {
    readIdentity: vi.fn(async () => ({ title: "Canal X", about: "sobre", photo: null })),
    createChannel: vi.fn(async () => ({ channelId: "111", accessHash: "222" })),
    setAbout: vi.fn(async () => {}),
    setPhoto: vi.fn(async () => {}),
    promoteBot: vi.fn(async () => {}),
    exportInvite: vi.fn(async () => "https://t.me/+abc"),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

const input = {
  jobId: "j1",
  source: { peerId: "9", peerType: "channel" as const, accessHash: "8" },
  destKind: "broadcast" as const,
  destTitle: "Canal X (clone)",
  copyIdentity: true,
  botUsername: "meu_bot",
  forum: false,
  existing: null,
};

describe("deriveDestKind", () => {
  it.each([
    ["channel_owner", "broadcast"],
    ["channel_subscriber", "broadcast"],
    ["group_admin", "megagroup"],
    ["group_member", "megagroup"],
  ])("%s vira %s", (kind, expected) => {
    expect(deriveDestKind(kind)).toBe(expected);
  });

  it("recusa kind que não é canal nem grupo", () => {
    expect(() => deriveDestKind("bot")).toThrow(/DIALOG_KIND_NAO_CLONAVEL/);
  });
});

describe("ensureDestination", () => {
  it("cria o destino, aplica identidade, promove o bot e exporta o convite", async () => {
    const d = deps();
    const out = await ensureDestination(d, input);

    expect(d.createChannel).toHaveBeenCalledWith("Canal X (clone)", "sobre", {
      megagroup: false,
      forum: false,
    });
    expect(d.setAbout).toHaveBeenCalled();
    expect(d.promoteBot).toHaveBeenCalledWith("111", "222", "meu_bot");
    expect(out).toEqual({
      channelId: "111",
      accessHash: "222",
      inviteLink: "https://t.me/+abc",
    });
    expect(d.persist).toHaveBeenCalledWith("j1", out);
  });

  it("persiste o canal assim que ele existe, antes do promoteBot (fatal)", async () => {
    const d = deps({
      promoteBot: vi.fn(async () => {
        throw new Error("BOT_GROUPS_BLOCKED");
      }),
    });

    await expect(ensureDestination(d, input)).rejects.toThrow(/BOT_GROUPS_BLOCKED/);

    // O canal criado tem que já estar gravado quando promoteBot explode,
    // senão a retomada do job cria um segundo canal e queima outra unidade
    // da cota diária de CreateChannel.
    expect(d.persist).toHaveBeenCalledWith("j1", {
      channelId: "111",
      accessHash: "222",
      inviteLink: null,
    });
    expect(d.persist).toHaveBeenCalledTimes(1);
  });

  it("cria supergrupo quando destKind é megagroup", async () => {
    const d = deps();
    await ensureDestination(d, { ...input, destKind: "megagroup" });
    expect(d.createChannel).toHaveBeenCalledWith("Canal X (clone)", "sobre", {
      megagroup: true,
      forum: false,
    });
  });

  it("cria supergrupo com fórum quando input.forum é true", async () => {
    const d = deps();
    await ensureDestination(d, { ...input, destKind: "megagroup", forum: true });
    expect(d.createChannel).toHaveBeenCalledWith("Canal X (clone)", "sobre", {
      megagroup: true,
      forum: true,
    });
  });

  it("não copia about nem foto quando copyIdentity é false", async () => {
    const d = deps();
    await ensureDestination(d, { ...input, copyIdentity: false });
    expect(d.createChannel).toHaveBeenCalledWith("Canal X (clone)", "", {
      megagroup: false,
      forum: false,
    });
    expect(d.setAbout).not.toHaveBeenCalled();
    expect(d.setPhoto).not.toHaveBeenCalled();
  });

  it("é idempotente na retomada: canal e identidade não são refeitos", async () => {
    const d = deps();
    const existing = { channelId: "77", accessHash: "88", inviteLink: null };
    const out = await ensureDestination(d, { ...input, existing });

    // Canal e identidade não podem ser recriados no caminho de retomada —
    // inclusive persist e readIdentity, que uma regressão poderia
    // reintroduzir sem quebrar o retorno (e queimaria outra unidade da cota
    // diária de CreateChannel).
    expect(d.readIdentity).not.toHaveBeenCalled();
    expect(d.createChannel).not.toHaveBeenCalled();
    expect(d.setAbout).not.toHaveBeenCalled();
    expect(d.setPhoto).not.toHaveBeenCalled();
    expect(d.exportInvite).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
    expect(out).toEqual(existing);
  });

  it("defeito I4: na retomada, promoteBot roda de novo mesmo com destino já existente", async () => {
    // Antes do fix, `if (input.existing) return input.existing;` devolvia
    // cedo demais — se o job anterior falhou DEPOIS de persistir
    // dest_channel_id mas ANTES do promoteBot completar (Group Privacy do
    // bot, FLOOD/PEER_FLOOD na promoção), o canal ficava órfão pra sempre: a
    // retomada nunca revisitava a promoção, e toda publicação falhava com
    // CHAT_ADMIN_REQUIRED sem que nenhum resume corrigisse.
    const d = deps();
    const existing = { channelId: "77", accessHash: "88", inviteLink: null };
    const out = await ensureDestination(d, { ...input, existing });

    expect(d.promoteBot).toHaveBeenCalledWith("77", "88", "meu_bot");
    expect(d.promoteBot).toHaveBeenCalledTimes(1);
    expect(out).toEqual(existing);
  });

  it("falha de foto e de convite não derruba a criação", async () => {
    const d = deps({
      setPhoto: vi.fn(async () => {
        throw new Error("PHOTO_INVALID");
      }),
      exportInvite: vi.fn(async () => {
        throw new Error("FLOOD");
      }),
      readIdentity: vi.fn(async () => ({
        title: "Canal X",
        about: "sobre",
        photo: Buffer.from("x"),
      })),
    });
    const out = await ensureDestination(d, input);
    expect(out.channelId).toBe("111");
    expect(out.inviteLink).toBeNull();
    expect(d.setPhoto).toHaveBeenCalledWith("111", "222", Buffer.from("x"));
    expect(d.persist).toHaveBeenCalledWith("j1", {
      channelId: "111",
      accessHash: "222",
      inviteLink: null,
    });
  });

  it("falha de promoção do bot é fatal (sem bot não há publicação)", async () => {
    const d = deps({
      promoteBot: vi.fn(async () => {
        throw new Error("BOT_GROUPS_BLOCKED");
      }),
    });
    await expect(ensureDestination(d, input)).rejects.toThrow(/BOT_GROUPS_BLOCKED/);
  });
});
