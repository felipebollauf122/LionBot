import { describe, it, expect } from "vitest";
import { validateMessage } from "@/lib/social-proof/validate-message";
import type { MessageInput } from "@/lib/social-proof/types";

/**
 * `document` e `poll` só existem em `mtproto_scheduled_messages` — o clone os
 * traz e o bot sabe publicá-los, mas o editor não os monta. Antes desta
 * abertura, quem clonasse um canal de PDFs não conseguia salvar nem uma
 * correção de legenda: a validação recusava porque `media[0].type` vem
 * "photo" numa linha de documento, e porque uma enquete não tem mídia.
 *
 * `kind` é forçado com `as MessageInput["kind"]` pelo mesmo motivo que
 * paraInput faz: o union do editor não tem esses dois.
 */
function input(over: Partial<MessageInput> = {}): MessageInput {
  return {
    sender_kind: "owner",
    sender_name: "",
    sender_avatar_url: null,
    kind: "text",
    content_text: "Segue o contrato.",
    media: [],
    reactions: [],
    reply_to_id: null,
    display_time: null,
    offset_seconds: 0,
    views_count: 0,
    ...over,
  };
}

const DOCUMENT = "document" as MessageInput["kind"];
const POLL = "poll" as MessageInput["kind"];

describe("validateMessage com os tipos que só a campanha tem", () => {
  it("aceita documento cuja mídia veio marcada como photo", () => {
    expect(
      validateMessage(
        input({ kind: DOCUMENT, media: [{ url: "https://x/contrato.pdf", type: "photo" }] }),
      ),
    ).toEqual({ ok: true });
  });

  it("aceita documento sem legenda", () => {
    expect(
      validateMessage(
        input({
          kind: DOCUMENT,
          content_text: null,
          media: [{ url: "https://x/contrato.pdf", type: "photo" }],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("aceita enquete sem mídia e sem legenda", () => {
    // A pergunta e as opções vivem na coluna `poll`, que nem o validador nem
    // o editor tocam — "vazia" aqui não quer dizer vazia no Telegram.
    expect(validateMessage(input({ kind: POLL, content_text: null, media: [] }))).toEqual({
      ok: true,
    });
  });

  it("as demais regras continuam valendo nesses tipos", () => {
    expect(
      validateMessage(input({ kind: DOCUMENT, content_text: "a".repeat(1025) })),
    ).toEqual({ ok: false, error: "O texto passa de 1024 caracteres." });

    expect(validateMessage(input({ kind: POLL, display_time: "25:00" })).ok).toBe(false);

    expect(
      validateMessage(input({ kind: DOCUMENT, sender_kind: "member", sender_name: "  " })),
    ).toEqual({ ok: false, error: "O nome do remetente não pode ficar vazio." });
  });

  it("os tipos do editor não foram afrouxados", () => {
    // A abertura vale só pros dois tipos sem editor: "photo" com vídeo dentro
    // continua sendo erro, e texto vazio continua sendo erro.
    expect(
      validateMessage(input({ kind: "photo", media: [{ url: "a", type: "video" }] })),
    ).toEqual({ ok: false, error: "A mídia enviada não é do tipo escolhido." });

    expect(validateMessage(input({ content_text: "   ", media: [] }))).toEqual({
      ok: false,
      error: "A mensagem precisa de texto ou mídia.",
    });
  });
});
