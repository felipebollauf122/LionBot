import { describe, it, expect } from "vitest";
import { resolveSender } from "@/lib/social-proof/sender";
import type { FeedChannel, FeedMessage } from "@/lib/social-proof/types";

const canal: FeedChannel = {
  title: "teste",
  avatarUrl: "lobo.png",
  subscribersLabel: "52 321 inscritos",
  isVerified: true,
  ownerName: "Daniel",
  ownerAvatarUrl: "daniel.png",
  ownerUsername: "daniel_oficial",
  unreadBadge: 243,
};

function msg(over: Partial<FeedMessage> = {}): FeedMessage {
  return {
    id: "m1",
    senderKind: "member",
    senderName: "Ana",
    senderAvatarUrl: null,
    kind: "text",
    contentText: "oi",
    media: [],
    reactions: [],
    replyToText: null,
    replyToSender: null,
    offsetSeconds: 600,
    displayTime: null,
    viewsCount: 0,
    ...over,
  };
}

describe("resolveSender", () => {
  it("membro usa o próprio nome e avatar", () => {
    expect(resolveSender(msg({ senderName: "Ana", senderAvatarUrl: "ana.png" }), canal)).toEqual({
      name: "Ana",
      avatarUrl: "ana.png",
      badge: null,
    });
  });

  it("membro sem avatar fica com null, pra cair na inicial colorida", () => {
    expect(resolveSender(msg({ senderAvatarUrl: null }), canal).avatarUrl).toBeNull();
  });

  it("dona usa a identidade do canal, não a da mensagem", () => {
    const out = resolveSender(msg({ senderKind: "owner", senderName: "ignorado" }), canal);
    expect(out.name).toBe("Daniel");
    expect(out.avatarUrl).toBe("daniel.png");
  });

  it("admin ganha o selo 'admin'", () => {
    expect(resolveSender(msg({ senderKind: "owner" }), canal).badge).toBe("admin");
  });

  it("membro nunca ganha selo", () => {
    expect(resolveSender(msg({ senderKind: "member" }), canal).badge).toBeNull();
  });

  it("dona sem nome cadastrado cai no título do canal", () => {
    // Senão a bolha sairia com nome vazio, que é pior que redundante.
    const semDona = { ...canal, ownerName: "" };
    expect(resolveSender(msg({ senderKind: "owner" }), semDona).name).toBe("teste");
  });

  it("membro sem nome cai em 'Membro'", () => {
    expect(resolveSender(msg({ senderName: "   " }), canal).name).toBe("Membro");
  });
});
