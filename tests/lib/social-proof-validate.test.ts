import { describe, it, expect } from "vitest";
import { validateMessage } from "@/lib/social-proof/validate-message";
import type { MessageInput } from "@/lib/social-proof/types";

function input(over: Partial<MessageInput> = {}): MessageInput {
  return {
    sender_kind: "member",
    sender_name: "Ana",
    sender_avatar_url: null,
    kind: "text",
    content_text: "oi",
    media: [],
    reactions: [],
    reply_to_id: null,
    display_time: null,
    offset_seconds: 600,
    views_count: 0,
    ...over,
  };
}

describe("validateMessage", () => {
  it("aceita texto simples", () => {
    expect(validateMessage(input())).toEqual({ ok: true });
  });

  it("recusa mensagem sem texto e sem mídia", () => {
    const out = validateMessage(input({ content_text: "  ", media: [] }));
    expect(out).toEqual({ ok: false, error: "A mensagem precisa de texto ou mídia." });
  });

  it("aceita mídia sem texto", () => {
    expect(
      validateMessage(input({ kind: "photo", content_text: null, media: [{ url: "a", type: "photo" }] })),
    ).toEqual({ ok: true });
  });

  it("recusa membro sem nome", () => {
    const out = validateMessage(input({ sender_name: "   " }));
    expect(out).toEqual({ ok: false, error: "O nome do remetente não pode ficar vazio." });
  });

  it("dona não precisa de nome de remetente", () => {
    // A identidade vem do canal, não da mensagem.
    expect(validateMessage(input({ sender_kind: "owner", sender_name: "" }))).toEqual({ ok: true });
  });

  it("recusa offset negativo", () => {
    expect(validateMessage(input({ offset_seconds: -1 }))).toEqual({
      ok: false,
      error: "O tempo atrás não pode ser negativo.",
    });
  });

  it("recusa views negativas", () => {
    expect(validateMessage(input({ views_count: -3 }))).toEqual({
      ok: false,
      error: "As visualizações não podem ser negativas.",
    });
  });

  it("recusa álbum com menos de duas mídias", () => {
    const out = validateMessage(input({ kind: "album", media: [{ url: "a", type: "photo" }] }));
    expect(out).toEqual({ ok: false, error: "Um álbum precisa de pelo menos duas mídias." });
  });

  it("aceita álbum com duas mídias", () => {
    expect(
      validateMessage(
        input({ kind: "album", media: [{ url: "a", type: "photo" }, { url: "b", type: "video" }] }),
      ),
    ).toEqual({ ok: true });
  });

  it("recusa tipo de mídia que não bate com o kind", () => {
    const out = validateMessage(input({ kind: "photo", media: [{ url: "a", type: "video" }] }));
    expect(out).toEqual({ ok: false, error: "A mídia enviada não é do tipo escolhido." });
  });

  it("recusa kind de mídia sem mídia nenhuma", () => {
    const out = validateMessage(input({ kind: "video", media: [] }));
    expect(out).toEqual({ ok: false, error: "Escolha um arquivo ou cole uma URL." });
  });

  it("recusa horário fora do formato HH:MM", () => {
    expect(validateMessage(input({ display_time: "2:5" }))).toEqual({
      ok: false,
      error: "O horário precisa estar no formato HH:MM.",
    });
    expect(validateMessage(input({ display_time: "25:00" })).ok).toBe(false);
    expect(validateMessage(input({ display_time: "12:60" })).ok).toBe(false);
  });

  it("aceita horário válido e horário vazio", () => {
    expect(validateMessage(input({ display_time: "02:44" }))).toEqual({ ok: true });
    expect(validateMessage(input({ display_time: null }))).toEqual({ ok: true });
  });

  it("recusa texto acima de 1024 caracteres", () => {
    const out = validateMessage(input({ content_text: "a".repeat(1025) }));
    expect(out).toEqual({ ok: false, error: "O texto passa de 1024 caracteres." });
  });
});
