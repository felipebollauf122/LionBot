import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
import { FloodWaitError } from "telegram/errors/index.js";
import { rewriteMessageLinks } from "../../src/services/mtproto/clone/link-replace.js";
import type { LinkReplaceDeps, LinkReplaceValues } from "../../src/services/mtproto/clone/link-replace.js";
import type { InlineLink } from "../../src/services/mtproto/clone/bot-client.js";
import type { PeerKind } from "../../src/services/mtproto/client.js";

function classifyMock(result: PeerKind | ((id: string) => PeerKind)): {
  classify: ReturnType<typeof vi.fn>;
} {
  const fn =
    typeof result === "function"
      ? (id: string) => Promise.resolve(result(id))
      : () => Promise.resolve(result);
  return { classify: vi.fn(fn) };
}

const NO_VALUES: LinkReplaceValues = {};

describe("rewriteMessageLinks", () => {
  it("mensagem sem entities e sem botões: classify nunca chamado (fast path)", async () => {
    const deps = classifyMock("bot");
    const out = await rewriteMessageLinks(
      { message: "oi, tudo bem?", entities: undefined, inlineLinks: undefined },
      deps,
      { botUsername: "novobot" },
    );
    expect(out.text).toBe("oi, tudo bem?");
    expect(deps.classify).not.toHaveBeenCalled();
  });

  it("Mention classificada 'bot' com botUsername configurado: troca por @{bot}", async () => {
    const text = "fale com @velhobot agora";
    const offset = text.indexOf("@velhobot");
    const entities = [new Api.MessageEntityMention({ offset, length: "@velhobot".length })];
    const deps = classifyMock("bot");

    const out = await rewriteMessageLinks(
      { message: text, entities, inlineLinks: undefined },
      deps,
      { botUsername: "novobot" },
    );

    expect(out.text).toBe("fale com @novobot agora");
    expect(deps.classify).toHaveBeenCalledWith("@velhobot");
  });

  it("mesmo identificador duas vezes na mensagem: classify chamado só uma vez (dedup)", async () => {
    const text = "@meubot e de novo @meubot";
    const first = text.indexOf("@meubot");
    const second = text.lastIndexOf("@meubot");
    const entities = [
      new Api.MessageEntityMention({ offset: first, length: "@meubot".length }),
      new Api.MessageEntityMention({ offset: second, length: "@meubot".length }),
    ];
    const deps = classifyMock("bot");

    await rewriteMessageLinks({ message: text, entities, inlineLinks: undefined }, deps, {
      botUsername: "novobot",
    });

    expect(deps.classify).toHaveBeenCalledTimes(1);
  });

  it("classificado 'group' mas só botUsername está configurado: entidade fica intocada", async () => {
    const text = "junte @meugrupo";
    const offset = text.indexOf("@meugrupo");
    const entities = [new Api.MessageEntityMention({ offset, length: "@meugrupo".length })];
    const deps = classifyMock("group");

    const out = await rewriteMessageLinks(
      { message: text, entities, inlineLinks: undefined },
      deps,
      { botUsername: "novobot" }, // sem groupLink
    );

    expect(out.text).toBe(text);
  });

  it("classificado 'user' (pessoa comum) nunca troca, mesmo com tudo configurado", async () => {
    const text = "fale com @pessoa";
    const offset = text.indexOf("@pessoa");
    const entities = [new Api.MessageEntityMention({ offset, length: "@pessoa".length })];
    const deps = classifyMock("user");

    const out = await rewriteMessageLinks({ message: text, entities, inlineLinks: undefined }, deps, {
      botUsername: "novobot",
      groupLink: "https://t.me/novogrupo",
      channelLink: "https://t.me/novocanal",
    });

    expect(out.text).toBe(text);
  });

  it("identificador não parseável (não-Telegram): classify nunca chamado, entidade intocada", async () => {
    const text = "veja https://outrosite.com/pagina";
    const offset = text.indexOf("https://");
    const entities = [new Api.MessageEntityUrl({ offset, length: "https://outrosite.com/pagina".length })];
    const deps = classifyMock("bot");

    const out = await rewriteMessageLinks(
      { message: text, entities, inlineLinks: undefined },
      deps,
      { groupLink: "https://t.me/novogrupo" },
    );

    expect(deps.classify).not.toHaveBeenCalled();
    expect(out.text).toBe(text);
  });

  it("classify resolve 'unknown': entidade intocada, sem lançar", async () => {
    const text = "junte @naosei";
    const offset = text.indexOf("@naosei");
    const entities = [new Api.MessageEntityMention({ offset, length: "@naosei".length })];
    const deps = classifyMock("unknown");

    const out = await rewriteMessageLinks(
      { message: text, entities, inlineLinks: undefined },
      deps,
      { groupLink: "https://t.me/novogrupo", channelLink: "https://t.me/novocanal", botUsername: "novobot" },
    );

    expect(out.text).toBe(text);
  });

  it("flood no classify propaga (rejects) — sem try/catch escondendo", async () => {
    const text = "junte @algo";
    const offset = text.indexOf("@algo");
    const entities = [new Api.MessageEntityMention({ offset, length: "@algo".length })];
    const deps: LinkReplaceDeps = {
      classify: vi.fn(async () => {
        throw new FloodWaitError({ request: undefined as never, capture: 30 } as never);
      }),
    };

    await expect(
      rewriteMessageLinks({ message: text, entities, inlineLinks: undefined }, deps, {
        botUsername: "novobot",
      }),
    ).rejects.toBeInstanceOf(FloodWaitError);
  });

  it("TextUrl classifica pelo .url (destino), NUNCA pelo texto visível", async () => {
    const text = "clique aqui";
    const entity = new Api.MessageEntityTextUrl({
      offset: 0,
      length: text.length,
      url: "https://t.me/canalvelho",
    });
    const deps = classifyMock("channel");

    const out = await rewriteMessageLinks(
      { message: text, entities: [entity], inlineLinks: undefined },
      deps,
      { channelLink: "t.me/canalnovo" },
    );

    expect(deps.classify).toHaveBeenCalledWith("https://t.me/canalvelho");
    // Label preservado, só o destino muda.
    expect(out.text).toBe("clique aqui");
    const outEntity = out.entities?.[0] as Api.MessageEntityTextUrl;
    expect(outEntity.url).toBe("https://t.me/canalnovo"); // scheme garantido
    expect(outEntity.offset).toBe(0);
    expect(outEntity.length).toBe(text.length);
  });

  it("botão inline classificado troca .url (com scheme garantido), label intocado", async () => {
    const link: InlineLink = { label: "Entrar no grupo", url: "https://t.me/grupovelho" };
    const deps = classifyMock("group");

    const out = await rewriteMessageLinks(
      { message: "", entities: undefined, inlineLinks: [link] },
      deps,
      { groupLink: "t.me/gruponovo" }, // sem scheme no valor configurado
    );

    expect(out.inlineLinks?.[0]).toEqual({ label: "Entrar no grupo", url: "https://t.me/gruponovo" });
  });

  it("botão inline com URL não-Telegram fica intocado", async () => {
    const link: InlineLink = { label: "Site", url: "https://outrosite.com" };
    const deps = classifyMock("group");

    const out = await rewriteMessageLinks(
      { message: "", entities: undefined, inlineLinks: [link] },
      deps,
      { groupLink: "t.me/gruponovo" },
    );

    expect(out.inlineLinks?.[0]).toBe(link);
    expect(deps.classify).not.toHaveBeenCalled();
  });

  it("inlineLinks undefined na entrada continua undefined na saída", async () => {
    const text = "@meubot";
    const entities = [new Api.MessageEntityMention({ offset: 0, length: text.length })];
    const deps = classifyMock("bot");

    const out = await rewriteMessageLinks(
      { message: text, entities, inlineLinks: undefined },
      deps,
      { botUsername: "novobot" },
    );

    expect(out.inlineLinks).toBeUndefined();
  });

  it("MessageEntityUrl classificado como grupo vira novo texto sem virar mention", async () => {
    const text = "veja t.me/grupovelho";
    const offset = text.indexOf("t.me/grupovelho");
    const entities = [new Api.MessageEntityUrl({ offset, length: "t.me/grupovelho".length })];
    const deps = classifyMock("group");

    const out = await rewriteMessageLinks(
      { message: text, entities, inlineLinks: undefined },
      deps,
      { groupLink: "t.me/gruponovo" },
    );

    expect(out.text).toBe("veja t.me/gruponovo");
    expect(out.entities?.[0]).toBeInstanceOf(Api.MessageEntityUrl);
  });

  it("sem valores configurados: nada troca mesmo com entidades classificáveis", async () => {
    const text = "@meubot e t.me/meugrupo";
    const botOffset = text.indexOf("@meubot");
    const groupOffset = text.indexOf("t.me/meugrupo");
    const entities = [
      new Api.MessageEntityMention({ offset: botOffset, length: "@meubot".length }),
      new Api.MessageEntityUrl({ offset: groupOffset, length: "t.me/meugrupo".length }),
    ];
    const deps = classifyMock((id) => (id.startsWith("@") ? "bot" : "group"));

    const out = await rewriteMessageLinks(
      { message: text, entities, inlineLinks: undefined },
      deps,
      NO_VALUES,
    );

    expect(out.text).toBe(text);
  });
});
