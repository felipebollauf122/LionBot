import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { campaignTimeline, type TimelineRow } from "@/lib/composer/schedule";
import { FeedPreview } from "@/components/dashboard/social-proof/feed-preview";
import type { ComposerMessageRow } from "@/lib/composer/types";
import type { ChannelInput } from "@/lib/social-proof/types";

// Mesmo motivo de composer-row-defaults.test.tsx: components/telegram/fonts.ts
// chama next/font/google em tempo de módulo, o que só existe dentro do build
// do Next.
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "mock-tgc-font-inter" }),
  Roboto: () => ({ variable: "mock-tgc-font-roboto" }),
}));

const HORA = 3600;

function linha(over: Partial<TimelineRow> & { id: string }): TimelineRow {
  return { delay_seconds: HORA, ai_discarded: false, scheduled_at: null, ...over };
}

const inicio = new Date("2026-09-08T09:00:00-03:00");

describe("campaignTimeline", () => {
  it("ancora na última postagem, então nenhum offset é negativo", () => {
    // É esta a razão de existir da função: `offsetToDate` apara offset
    // negativo em zero (decisão travada da Prova Social), e uma campanha
    // agendada pro futuro tem TODAS as mensagens no futuro. Ancorando no
    // agora, tudo colapsaria no mesmo horário.
    const futuro = new Date(Date.now() + 30 * 24 * HORA * 1000);
    const { offsetSeconds } = campaignTimeline(
      [linha({ id: "a" }), linha({ id: "b" }), linha({ id: "c" })],
      futuro,
    );

    expect([...offsetSeconds.values()].every((s) => s >= 0)).toBe(true);
  });

  it("distribui os offsets pela cadência, com a última em zero", () => {
    const { anchor, offsetSeconds } = campaignTimeline(
      [
        linha({ id: "a", delay_seconds: 0 }),
        linha({ id: "b", delay_seconds: HORA }),
        linha({ id: "c", delay_seconds: 2 * HORA }),
      ],
      inicio,
    );

    // Primeira sai no início; depois +1h e +2h. A âncora é a última.
    expect(anchor.toISOString()).toBe(new Date("2026-09-08T12:00:00-03:00").toISOString());
    expect(offsetSeconds.get("a")).toBe(3 * HORA);
    expect(offsetSeconds.get("b")).toBe(2 * HORA);
    expect(offsetSeconds.get("c")).toBe(0);
  });

  it("prefere o scheduled_at real quando ele já existe", () => {
    const { anchor, offsetSeconds } = campaignTimeline(
      [
        linha({ id: "a", delay_seconds: 0, scheduled_at: "2026-09-08T09:00:00-03:00" }),
        linha({ id: "b", scheduled_at: "2026-09-08T15:00:00-03:00" }),
      ],
      inicio,
    );

    // 15:00 é o real gravado, não as 10:00 que a projeção daria.
    expect(anchor.toISOString()).toBe(new Date("2026-09-08T15:00:00-03:00").toISOString());
    expect(offsetSeconds.get("a")).toBe(6 * HORA);
    expect(offsetSeconds.get("b")).toBe(0);
  });

  it("linha descartada não consome o próprio delay nem move a fila", () => {
    const { offsetSeconds } = campaignTimeline(
      [
        linha({ id: "a", delay_seconds: 0 }),
        linha({ id: "descartada", delay_seconds: 5 * HORA, ai_discarded: true }),
        linha({ id: "c", delay_seconds: HORA }),
      ],
      inicio,
    );

    // "c" cai 1h depois de "a", e não 6h: o delay da descartada não conta.
    expect(offsetSeconds.get("a")).toBe(HORA);
    expect(offsetSeconds.get("c")).toBe(0);
    // A descartada fica onde está na fila — no momento da anterior.
    expect(offsetSeconds.get("descartada")).toBe(HORA);
  });

  it("sem linha nenhuma, a âncora é o próprio início", () => {
    const { anchor, offsetSeconds } = campaignTimeline([], inicio);
    expect(anchor.toISOString()).toBe(inicio.toISOString());
    expect(offsetSeconds.size).toBe(0);
  });
});

const canal: ChannelInput = {
  title: "Canal de destino",
  avatar_url: null,
  subscribers_label: "",
  is_verified: false,
  is_active: true,
  owner_name: "Canal de destino",
  owner_avatar_url: null,
  owner_username: "",
  unread_badge: 0,
};

/** Os horários que a prévia desenhou, na ordem das bolhas. */
function horariosNaTela(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".tg-meta")].map((e) => e.textContent ?? "");
}

describe("prévia da campanha ancorada no fim da sequência", () => {
  it("desenha cada mensagem num horário DIFERENTE, não todas de uma vez", () => {
    // A regressão que este teste existe pra pegar: ancorar no agora faz todos
    // os offsets ficarem negativos, `offsetToDate` apara todos em zero, e as
    // três bolhas saem no mesmo minuto — numa tela que promete mostrar quando
    // cada post vai ao ar.
    const rows: TimelineRow[] = [
      linha({ id: "m1", delay_seconds: 0 }),
      linha({ id: "m2", delay_seconds: HORA }),
      // 25h depois: joga a terceira pro dia seguinte.
      linha({ id: "m3", delay_seconds: 25 * HORA }),
    ];
    const { anchor, offsetSeconds } = campaignTimeline(rows, inicio);

    const mensagens: ComposerMessageRow[] = rows.map((r, i) => ({
      id: r.id,
      kind: "text",
      content_text: `Post ${i + 1}`,
      media: [],
      reply_to_id: null,
      offset_seconds: offsetSeconds.get(r.id) ?? 0,
    }));

    const { container } = render(
      <FeedPreview
        channel={canal}
        messages={mensagens}
        draft={null}
        pinnedText=""
        now={anchor}
      />,
    );

    const horarios = horariosNaTela(container);
    expect(horarios).toEqual(["09:00", "10:00", "11:00"]);
    expect(new Set(horarios).size).toBe(3);
  });

  it("uma campanha que atravessa dias mantém os separadores de dia", () => {
    const rows: TimelineRow[] = [
      linha({ id: "m1", delay_seconds: 0 }),
      linha({ id: "m2", delay_seconds: 25 * HORA }),
    ];
    const { anchor, offsetSeconds } = campaignTimeline(rows, inicio);

    const { container } = render(
      <FeedPreview
        channel={canal}
        messages={rows.map((r, i) => ({
          id: r.id,
          kind: "text",
          content_text: `Post ${i + 1}`,
          media: [],
          reply_to_id: null,
          offset_seconds: offsetSeconds.get(r.id) ?? 0,
        }))}
        draft={null}
        pinnedText=""
        now={anchor}
      />,
    );

    // Dois dias, dois chips — e não um "Hoje" só cobrindo a campanha inteira.
    const dias = [...container.querySelectorAll(".tg-date")].map((e) => e.textContent);
    expect(dias).toEqual(["Ontem", "Hoje"]);
  });

  it("sem a prop `now`, a prévia continua relativa ao agora (Prova Social)", () => {
    const { container } = render(
      <FeedPreview
        channel={canal}
        messages={[
          {
            id: "m1",
            kind: "text",
            content_text: "Prova social",
            media: [],
            reply_to_id: null,
            offset_seconds: 0,
          },
        ]}
        draft={null}
        pinnedText=""
      />,
    );

    expect(container.querySelectorAll(".tg-date")).toHaveLength(1);
    expect(container.querySelector(".tg-date")?.textContent).toBe("Hoje");
  });
});
