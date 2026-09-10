import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GrammyError } from "grammy";
import {
  nextFloodSchedule,
  handleScheduledSend,
} from "../../src/workers/scheduled-campaign-handler.js";

const AGORA = new Date("2026-09-10T12:00:00.000Z");

describe("nextFloodSchedule", () => {
  it("a mensagem que bateu flood volta pra depois da espera, com folga de 5s", () => {
    const r = nextFloodSchedule({ now: AGORA, waitSeconds: 60, pendentes: [] });
    expect(r.retryAt.toISOString()).toBe("2026-09-10T12:01:05.000Z");
  });

  it("as seguintes são empurradas pelo MESMO delta, preservando a cadência", () => {
    // Sem o empurrão, a fila inteira vence durante o flood e o bot despeja
    // tudo de uma vez quando ele passa — que é o que queima a conta.
    const r = nextFloodSchedule({
      now: AGORA,
      waitSeconds: 60,
      pendentes: [
        { id: "b", scheduledAt: new Date("2026-09-10T12:10:00.000Z") },
        { id: "c", scheduledAt: new Date("2026-09-10T12:20:00.000Z") },
      ],
    });
    expect(r.empurradas).toEqual([
      { id: "b", scheduledAt: new Date("2026-09-10T12:11:05.000Z") },
      { id: "c", scheduledAt: new Date("2026-09-10T12:21:05.000Z") },
    ]);
  });

  it("não empurra nada quando não há pendentes depois", () => {
    const r = nextFloodSchedule({ now: AGORA, waitSeconds: 30, pendentes: [] });
    expect(r.empurradas).toEqual([]);
  });

  it("uma pendente que já estava atrasada é empurrada a partir de agora, não do passado", () => {
    // Sem esse piso, uma mensagem já vencida continuaria vencida depois do
    // flood e sairia junto com a que acabou de ser reagendada.
    const r = nextFloodSchedule({
      now: AGORA,
      waitSeconds: 60,
      pendentes: [{ id: "b", scheduledAt: new Date("2026-09-10T11:50:00.000Z") }],
    });
    expect(r.empurradas[0].scheduledAt.toISOString()).toBe("2026-09-10T12:01:05.000Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fiação. Os quatro testes acima exercitam só a função pura: continuariam
// verdes com `reagendarPorFlood` apagado do arquivo. Estes provam que um 429
// da Bot API vindo do publish chega mesmo no ramo de reagendamento, e não no
// retry genérico.
// ─────────────────────────────────────────────────────────────────────────────

interface ChamadaDb {
  table: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  filtros: Record<string, unknown>;
  /** Argumentos de `.range(de, ate)`, pra provar a paginação da varredura. */
  range?: [number, number];
}

interface RespostaDb {
  data?: unknown;
  error?: unknown;
  count?: number;
}

interface FakeQuery {
  select: (...args: unknown[]) => FakeQuery;
  update: (payload: Record<string, unknown>) => FakeQuery;
  eq: (coluna: string, valor: unknown) => FakeQuery;
  in: (coluna: string, valor: unknown) => FakeQuery;
  not: (...args: unknown[]) => FakeQuery;
  order: (...args: unknown[]) => FakeQuery;
  range: (de: number, ate: number) => FakeQuery;
  limit: (...args: unknown[]) => FakeQuery;
  single: () => Promise<RespostaDb>;
  maybeSingle: () => Promise<RespostaDb>;
  then: (ok: (r: RespostaDb) => unknown, falha?: (e: unknown) => unknown) => Promise<unknown>;
}

const h = vi.hoisted(() => ({
  chamadas: [] as ChamadaDb[],
  responder: ((): RespostaDb => ({ data: null })) as (ch: ChamadaDb) => RespostaDb,
  erroDoPublish: null as unknown,
}));

vi.mock("../../src/db.js", () => {
  function from(table: string): FakeQuery {
    const ch: ChamadaDb = { table, op: "select", filtros: {} };
    const resolver = (): Promise<RespostaDb> => {
      h.chamadas.push(ch);
      return Promise.resolve(h.responder(ch));
    };
    const q: FakeQuery = {
      select: () => q,
      update: (payload) => {
        ch.op = "update";
        ch.payload = payload;
        return q;
      },
      eq: (coluna, valor) => {
        ch.filtros[coluna] = valor;
        return q;
      },
      in: (coluna, valor) => {
        ch.filtros[coluna] = valor;
        return q;
      },
      not: () => q,
      order: () => q,
      range: (de, ate) => {
        ch.range = [de, ate];
        return q;
      },
      limit: () => q,
      single: () => resolver(),
      maybeSingle: () => resolver(),
      then: (ok, falha) => resolver().then(ok, falha),
    };
    return q;
  }
  return { supabase: { from } };
});

vi.mock("../../src/services/mtproto/clone/bot-client.js", () => {
  class CompanionBot {
    static destChatIdFromChannelId(channelId: string): string {
      return `-100${channelId}`;
    }
    async publishText(): Promise<number> {
      if (h.erroDoPublish) throw h.erroDoPublish;
      return 4242;
    }
    async publishMedia(): Promise<number> {
      throw h.erroDoPublish;
    }
    async publishAlbum(): Promise<number[]> {
      throw h.erroDoPublish;
    }
    async publishPoll(): Promise<number> {
      throw h.erroDoPublish;
    }
    async pin(): Promise<void> {}
    async disconnect(): Promise<void> {}
  }
  return { CompanionBot };
});

const LINHA = {
  id: "m1",
  campaign_id: "camp-1",
  kind: "text",
  content_text: "oi",
  media: [],
  entities: null,
  inline_links: null,
  poll: null,
  file_name: null,
  silent: false,
  is_pinned: false,
  attempts: 0,
};

function responderPadrao(ch: ChamadaDb): RespostaDb {
  if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "select") {
    return {
      data: { id: "camp-1", tenant_id: "t-1", status: "running", dest_channel_id: "555" },
    };
  }
  if (ch.table === "automation_bots") {
    return { data: { token: "123:abc", username: "bot", status: "active" } };
  }
  if (ch.table === "mtproto_scheduled_messages") {
    // O claim CAS: update de pending -> sending. Devolve a linha reivindicada.
    // O banco devolve a linha COM o claimed_at que acabou de gravar; é dele
    // que sai a assinatura do claim usada nas escritas de desfecho.
    if (ch.op === "update" && ch.filtros.status === "pending") {
      return { data: { ...LINHA, claimed_at: ch.payload?.claimed_at } };
    }
    // A varredura de pendentes do reagendamento (status é a string "pending");
    // a contagem de concluirSeUltima passa um array em `in`, e cai no default.
    if (ch.op === "select" && ch.filtros.status === "pending") {
      return { data: [{ id: "m2", scheduled_at: "2026-09-10T12:10:00.000Z", position: 1 }] };
    }
  }
  return { data: { id: "m1" }, count: 0 };
}

describe("handleScheduledSend — fiação do flood da Bot API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    h.chamadas = [];
    h.responder = responderPadrao;
    h.erroDoPublish = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Escritas de resultado. O próprio claim é um update, e é o primeiro da
   * lista — sai daqui pelo filtro CAS dele (`status = 'pending'`), senão
   * qualquer `find` por id acharia o claim em vez do desfecho.
   */
  function updatesDeMensagem(): ChamadaDb[] {
    return h.chamadas.filter(
      (c) =>
        c.table === "mtproto_scheduled_messages" &&
        c.op === "update" &&
        c.filtros.status !== "pending",
    );
  }

  it("um 429 do publish reagenda a campanha inteira em vez de virar retry genérico", async () => {
    h.erroDoPublish = new GrammyError(
      "Call to 'sendMessage' failed! (429: Too Many Requests: retry after 30)",
      {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 30",
        parameters: { retry_after: 30 },
      },
      "sendMessage",
      {},
    );

    await handleScheduledSend("m1");

    const updates = updatesDeMensagem();
    const reagendada = updates.find(
      (u) => u.filtros.id === "m1" && u.payload?.error_message === "flood_wait_30s",
    );
    expect(reagendada, "a mensagem que bateu no flood deveria ter sido reagendada").toBeDefined();
    expect(reagendada?.payload?.status).toBe("pending");
    // 12:00:00 + (30 + 5)s
    expect(reagendada?.payload?.scheduled_at).toBe("2026-09-10T12:00:35.000Z");
    // Escrita CAS: só quem ainda detém o claim escreve.
    expect(reagendada?.filtros.status).toBe("sending");

    // E a pendente seguinte foi empurrada pelo MESMO delta.
    const empurrada = updates.find((u) => u.filtros.id === "m2");
    expect(empurrada?.payload?.scheduled_at).toBe("2026-09-10T12:10:35.000Z");

    // O que NÃO pode ter acontecido: o caminho genérico.
    expect(updates.some((u) => u.payload?.status === "failed")).toBe(false);
    expect(updates.some((u) => u.payload?.attempts !== undefined)).toBe(false);
  });

  it("erro que não é flood continua no retry genérico, contando a tentativa", async () => {
    h.erroDoPublish = new Error("Bad Request: chat not found");

    await handleScheduledSend("m1");

    const updates = updatesDeMensagem();
    const retry = updates.find((u) => u.filtros.id === "m1");
    expect(retry?.payload?.status).toBe("pending");
    expect(retry?.payload?.attempts).toBe(1);
    expect(retry?.filtros.status).toBe("sending");
    expect(updates.some((u) => u.filtros.id === "m2")).toBe(false);
  });

  it("a varredura de pendentes pagina, e todas as páginas são empurradas em ordem", async () => {
    // Sem `range`, o PostgREST corta em db-max-rows sem avisar e as pendentes
    // além do corte venceriam durante a espera — o despejo que o empurrão
    // existe pra impedir. Duas páginas: 500 (cheia, força a próxima) e 3.
    const base = Date.UTC(2026, 8, 10, 13, 0, 0);
    const pagina1 = Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      scheduled_at: new Date(base + i * 60_000).toISOString(),
      position: i,
    }));
    const pagina2 = Array.from({ length: 3 }, (_, i) => ({
      id: `q${i}`,
      scheduled_at: new Date(base + (500 + i) * 60_000).toISOString(),
      position: 500 + i,
    }));
    h.responder = (ch) => {
      if (
        ch.table === "mtproto_scheduled_messages" &&
        ch.op === "select" &&
        ch.filtros.status === "pending"
      ) {
        const de = ch.range?.[0] ?? 0;
        if (de === 0) return { data: pagina1 };
        if (de === 500) return { data: pagina2 };
        return { data: [] };
      }
      return responderPadrao(ch);
    };
    h.erroDoPublish = new GrammyError(
      "Call to 'sendMessage' failed! (429: Too Many Requests: retry after 60)",
      {
        ok: false,
        error_code: 429,
        description: "Too Many Requests: retry after 60",
        parameters: { retry_after: 60 },
      },
      "sendMessage",
      {},
    );

    await handleScheduledSend("m1");

    // Paginou de verdade, e parou na página incompleta.
    const paginas = h.chamadas
      .filter(
        (c) =>
          c.table === "mtproto_scheduled_messages" &&
          c.op === "select" &&
          c.filtros.status === "pending",
      )
      .map((c) => c.range);
    expect(paginas).toEqual([
      [0, 499],
      [500, 999],
    ]);

    // As 503 foram empurradas, na ordem em que a consulta devolveu.
    const empurradas = updatesDeMensagem().filter((u) => u.filtros.id !== "m1");
    expect(empurradas).toHaveLength(503);
    expect(empurradas[0].filtros.id).toBe("p0");
    expect(empurradas[499].filtros.id).toBe("p499");
    expect(empurradas[502].filtros.id).toBe("q2");

    // E cada uma pelo MESMO delta (60 + 5 = 65s), não pro mesmo instante.
    expect(empurradas[0].payload?.scheduled_at).toBe("2026-09-10T13:01:05.000Z");
    expect(empurradas[502].payload?.scheduled_at).toBe("2026-09-10T21:23:05.000Z");
  });

  it("com o claim intacto, grava o resultado preso ao próprio claim", async () => {
    await handleScheduledSend("m1");

    const escrita = updatesDeMensagem().find((u) => u.payload?.status === "sent");
    expect(escrita?.payload?.dest_msg_id).toBe(4242);
    expect(escrita?.filtros.status).toBe("sending");
    // A assinatura DESTE claim, não só "alguém está enviando".
    expect(escrita?.filtros.claimed_at).toBe(AGORA.toISOString());
    expect(
      h.chamadas.some((c) => c.table === "mtproto_scheduled_campaigns" && c.op === "update"),
    ).toBe(true);
  });

  it("quem teve o claim roubado não grava resultado nem mexe no contador (ABA)", async () => {
    // O sweep devolveu a linha pra 'pending' no meio da publicação, outro
    // worker reivindicou (status voltou a 'sending', claimed_at NOVO) e a
    // nossa conclusão chega atrasada: `status = 'sending'` sozinho ainda
    // casaria. Com o claimed_at no filtro, o CAS não casa e o desfecho do
    // vencedor fica de pé.
    h.responder = (ch) => {
      if (
        ch.table === "mtproto_scheduled_messages" &&
        ch.op === "update" &&
        ch.payload?.status === "sent"
      ) {
        return { data: null };
      }
      return responderPadrao(ch);
    };

    await handleScheduledSend("m1");

    const escrita = updatesDeMensagem().find((u) => u.payload?.status === "sent");
    expect(escrita?.filtros.claimed_at).toBe(AGORA.toISOString());
    expect(
      h.chamadas.some((c) => c.table === "mtproto_scheduled_campaigns" && c.op === "update"),
    ).toBe(false);
  });
});
