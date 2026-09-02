import { describe, it, expect } from "vitest";
import { normalizeMedia, kindFromMedia, formatDuration } from "@/lib/social-proof/media";

describe("normalizeMedia", () => {
  it("lista vazia quando não há nada", () => {
    expect(normalizeMedia([], null, null)).toEqual([]);
    expect(normalizeMedia(null, null, null)).toEqual([]);
  });

  it("lê a lista jsonb já no formato novo", () => {
    expect(normalizeMedia([{ url: "a.jpg", type: "photo" }])).toEqual([
      { url: "a.jpg", type: "photo" },
    ]);
  });

  it("preserva duração quando existe", () => {
    expect(normalizeMedia([{ url: "a.mp3", type: "audio", durationSeconds: 42 }])).toEqual([
      { url: "a.mp3", type: "audio", durationSeconds: 42 },
    ]);
  });

  it("cai nas colunas legadas quando a lista está vazia", () => {
    // Linhas gravadas antes da 073 e que o backfill não pegou.
    expect(normalizeMedia([], "velho.jpg", "image")).toEqual([
      { url: "velho.jpg", type: "photo" },
    ]);
  });

  it("traduz o 'image' legado para 'photo'", () => {
    expect(normalizeMedia([], "x.png", "image")[0].type).toBe("photo");
  });

  it("mantém 'video' legado como está", () => {
    expect(normalizeMedia([], "x.mp4", "video")[0].type).toBe("video");
  });

  it("a lista nova ganha da coluna legada quando as duas existem", () => {
    const out = normalizeMedia([{ url: "novo.jpg", type: "photo" }], "velho.jpg", "image");
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("novo.jpg");
  });

  it("descarta item sem url", () => {
    expect(normalizeMedia([{ type: "photo" }, { url: "ok.jpg", type: "photo" }])).toEqual([
      { url: "ok.jpg", type: "photo" },
    ]);
  });

  it("descarta item com type inválido", () => {
    expect(normalizeMedia([{ url: "x", type: "pdf" }])).toEqual([]);
  });

  it("entrada que não é lista vira lista vazia sem lançar", () => {
    expect(normalizeMedia("isso não é lista")).toEqual([]);
    expect(normalizeMedia(42)).toEqual([]);
  });
});

describe("kindFromMedia", () => {
  it("sem mídia é texto", () => {
    expect(kindFromMedia([], true)).toBe("text");
  });

  it("uma foto é photo", () => {
    expect(kindFromMedia([{ url: "a", type: "photo" }], false)).toBe("photo");
  });

  it("um vídeo é video", () => {
    expect(kindFromMedia([{ url: "a", type: "video" }], false)).toBe("video");
  });

  it("um áudio é audio", () => {
    expect(kindFromMedia([{ url: "a", type: "audio" }], false)).toBe("audio");
  });

  it("duas ou mais mídias é album", () => {
    expect(
      kindFromMedia([{ url: "a", type: "photo" }, { url: "b", type: "photo" }], false),
    ).toBe("album");
  });

  it("álbum misturando foto e vídeo continua album", () => {
    expect(
      kindFromMedia([{ url: "a", type: "photo" }, { url: "b", type: "video" }], false),
    ).toBe("album");
  });
});

describe("formatDuration", () => {
  it("formata segundos como m:ss", () => {
    expect(formatDuration(12)).toBe("0:12");
    expect(formatDuration(72)).toBe("1:12");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("zero e negativo viram 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(-5)).toBe("0:00");
  });

  it("passa de uma hora sem quebrar", () => {
    expect(formatDuration(3725)).toBe("62:05");
  });
});
