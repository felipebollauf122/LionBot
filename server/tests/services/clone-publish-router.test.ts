import { describe, it, expect } from "vitest";
import {
  chooseStrategy,
  routeGroup,
} from "../../src/services/mtproto/clone/publish-router.js";

describe("chooseStrategy", () => {
  it("auto vira batch quando a origem permite encaminhar", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("batch");
  });

  it("auto vira download quando a origem protege o conteúdo", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: true, copyButtons: false }),
    ).toBe("download");
  });

  it("botões inline forçam download mesmo com origem liberada", () => {
    expect(
      chooseStrategy({ requested: "auto", sourceHasNoForwards: false, copyButtons: true }),
    ).toBe("download");
  });

  it("batch pedido explicitamente ainda cai pra download se a origem protege", () => {
    expect(
      chooseStrategy({ requested: "batch", sourceHasNoForwards: true, copyButtons: false }),
    ).toBe("download");
  });

  it("download pedido explicitamente é respeitado", () => {
    expect(
      chooseStrategy({ requested: "download", sourceHasNoForwards: false, copyButtons: false }),
    ).toBe("download");
  });
});

describe("routeGroup", () => {
  const base = { strategy: "batch" as const, copyPolls: false, copyButtons: false };

  it("na rota batch, encaminha o grupo inteiro", () => {
    expect(
      routeGroup({ ...base, plans: [{ kind: "text" }, { kind: "media", mediaKind: "photo" }] }),
    ).toEqual({ mode: "forward" });
  });

  it("na rota batch, grupo com item não clonável ainda encaminha os clonáveis", () => {
    expect(
      routeGroup({
        ...base,
        plans: [{ kind: "text" }, { kind: "skip", reason: "media_invoice" }],
      }),
    ).toEqual({ mode: "forward", skipIndexes: [1] });
  });

  it("na rota batch, grupo todo não clonável é pulado sem chamar o Telegram", () => {
    expect(
      routeGroup({ ...base, plans: [{ kind: "skip", reason: "media_giveaway" }] }),
    ).toEqual({ mode: "skip_all" });
  });

  it("na rota download, álbum de fotos vai como álbum", () => {
    expect(
      routeGroup({
        ...base,
        strategy: "download",
        plans: [
          { kind: "media", mediaKind: "photo" },
          { kind: "media", mediaKind: "video" },
        ],
      }),
    ).toEqual({ mode: "album" });
  });

  it("na rota download, mensagem solta vai individual", () => {
    expect(
      routeGroup({ ...base, strategy: "download", plans: [{ kind: "text" }] }),
    ).toEqual({ mode: "single" });
  });

  it("na rota download, álbum com item não-álbum degrada para envios individuais", () => {
    expect(
      routeGroup({
        ...base,
        strategy: "download",
        plans: [
          { kind: "media", mediaKind: "photo" },
          { kind: "media", mediaKind: "document" },
        ],
      }),
    ).toEqual({ mode: "single" });
  });
});
