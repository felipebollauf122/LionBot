import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { toggleDiscarded } from "@/app/dashboard/automations/scheduled/actions";
import {
  criarSupabaseFake,
  type ChamadaFake,
  type RespostaFake,
} from "../helpers/fake-supabase";

/**
 * Descartar e restaurar uma mensagem da campanha.
 *
 * O defeito que a revisão de branch apontou: `launchScheduledCampaign`
 * carimba toda descartada como `status='skipped'`, e `toggleDiscarded` só
 * limpava `ai_discarded`. O botão "Restaurar" respondia sucesso e a mensagem
 * seguia fora de qualquer consulta do poller (que lê 'pending') — a tela
 * afirmava uma coisa que o banco não fazia.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/automations-access-actions", () => ({
  requireAutomationsAccess: vi.fn(async () => "user-1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCreateClient = vi.mocked(createClient);

function montar(
  msg: { status: string; scheduled_at: string | null } | null,
  statusCampanha = "draft",
) {
  return criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(
    (ch: ChamadaFake): RespostaFake => {
      if (ch.table === "mtproto_scheduled_messages" && ch.op === "select") {
        return { data: msg };
      }
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "select") {
        return { data: { status: statusCampanha } };
      }
      return { data: [{ id: "m1" }] };
    },
  );
}

/** As escritas de status (não a que mexe em ai_discarded). */
function escritasDeStatus(chamadas: ChamadaFake[]) {
  return chamadas.filter((c) => c.op === "update" && c.payload?.status !== undefined);
}

describe("toggleDiscarded — descartar e restaurar mexem na FILA, não só na alavanca", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restaurar uma mensagem que o disparo pulou devolve ela pra 'pending'", async () => {
    const { client, chamadas } = montar({ status: "skipped", scheduled_at: "2026-09-11T12:00:00Z" });
    mockCreateClient.mockResolvedValue(client);

    const r = await toggleDiscarded("m1", "camp-1", false);

    expect(r.ok).toBe(true);
    const bandeira = chamadas.find((c) => c.op === "update" && c.payload?.ai_discarded === false);
    expect(bandeira).toBeDefined();
    const status = escritasDeStatus(chamadas)[0];
    expect(status?.payload?.status).toBe("pending");
    // Presa ao valor de origem: nunca ressuscita uma 'sent'/'failed'.
    expect(status?.filtros.status).toBe("skipped");
    expect(status?.filtros.campaign_id).toBe("camp-1");
  });

  it("descartar uma pendente também a tira da fila", async () => {
    // A outra direção da mesma mentira: descartar durante a campanha
    // respondia sucesso e a mensagem ia ao ar do mesmo jeito.
    const { client, chamadas } = montar({ status: "pending", scheduled_at: "2026-09-11T12:00:00Z" });
    mockCreateClient.mockResolvedValue(client);

    const r = await toggleDiscarded("m1", "camp-1", true);

    expect(r.ok).toBe(true);
    const status = escritasDeStatus(chamadas)[0];
    expect(status?.payload?.status).toBe("skipped");
    expect(status?.filtros.status).toBe("pending");
  });

  it("restaurar numa campanha JÁ publicando, sem horário, recusa e explica o caminho", async () => {
    // Voltar pra 'pending' sem `scheduled_at` seria a mesma mentira: o poller
    // só publica pendente com horário, então ela nunca sairia.
    const { client, chamadas } = montar({ status: "skipped", scheduled_at: null }, "running");
    mockCreateClient.mockResolvedValue(client);

    const r = await toggleDiscarded("m1", "camp-1", false);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Pause a campanha e publique de novo/);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("restaurar sem horário numa campanha em rascunho segue normal (o disparo agenda depois)", async () => {
    const { client, chamadas } = montar({ status: "skipped", scheduled_at: null }, "draft");
    mockCreateClient.mockResolvedValue(client);

    const r = await toggleDiscarded("m1", "camp-1", false);

    expect(r.ok).toBe(true);
    expect(escritasDeStatus(chamadas)[0]?.payload?.status).toBe("pending");
  });

  it("mensagem de outra campanha (ou inexistente): recusa como dado, sem escrever", async () => {
    const { client, chamadas } = montar(null);
    mockCreateClient.mockResolvedValue(client);

    const r = await toggleDiscarded("m1", "camp-1", false);

    expect(r.ok).toBe(false);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("mensagem já enviada: a alavanca muda, mas o status não é tocado", async () => {
    const { client, chamadas } = montar({ status: "sent", scheduled_at: "2026-09-11T12:00:00Z" });
    mockCreateClient.mockResolvedValue(client);

    const r = await toggleDiscarded("m1", "camp-1", true);

    expect(r.ok).toBe(true);
    // A escrita de status existe, mas é presa a 'pending' — não pega a 'sent'.
    expect(escritasDeStatus(chamadas)[0]?.filtros.status).toBe("pending");
  });
});
