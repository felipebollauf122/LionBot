import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { launchScheduledCampaign } from "@/app/dashboard/automations/scheduled/actions";
import {
  criarSupabaseFake,
  type ChamadaFake,
  type RespostaFake,
} from "../helpers/fake-supabase";

/**
 * Transições de estado do disparo — as que a revisão de branch encontrou sem
 * teste nenhum por trás:
 *
 * - publicar uma campanha que ainda está sob a IA rebaixava ela pra 'draft'
 *   quando o worker terminasse, e o poller (que só enfileira
 *   status='running') parava a sequência no meio, sem erro nem badge;
 * - a escrita final ia com `.eq("id")` puro, então as recusas lidas antes
 *   dela eram só conselho: entre a leitura e a escrita a campanha podia
 *   entrar em 'running'/'ai_processing' por outra aba;
 * - `total_messages` recebia só a contagem de pendentes numa retomada,
 *   enquanto `sent_count` seguia acumulando — daí o "5/3 enviadas".
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/automations-access-actions", () => ({
  requireAutomationsAccess: vi.fn(async () => "user-1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCreateClient = vi.mocked(createClient);

type Chamada = ChamadaFake;
type Resposta = RespostaFake;

/** Cliente encadeável compartilhado — ver tests/helpers/fake-supabase.ts. */
function criarSupabase(responder: (ch: Chamada) => Resposta) {
  return criarSupabaseFake<Awaited<ReturnType<typeof createClient>>>(responder);
}

const CAMPANHA = {
  id: "camp-1",
  dest_channel_id: "555",
  dest_access_hash: "h",
  status: "draft",
};

/** Uma pendente, nenhuma terminada — o caso feliz do disparo. */
function respostaPadrao(status: string, terminadas = 0) {
  return (ch: Chamada): Resposta => {
    if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "select") {
      return { data: { ...CAMPANHA, status } };
    }
    if (ch.table === "mtproto_scheduled_messages" && ch.op === "select") {
      // A contagem de terminadas usa head:true e só olha `count`.
      if (Array.isArray(ch.filtros.status)) return { count: terminadas };
      return { data: [{ id: "m1", delay_seconds: 0, ai_discarded: false }] };
    }
    return { data: [{ id: "camp-1" }] };
  };
}

const INICIO = "2026-09-11T12:00:00.000Z";

describe("launchScheduledCampaign — o que pode e o que não pode virar 'running'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recusa publicar uma campanha em tratamento pela IA, e não escreve nada", async () => {
    const { client, chamadas } = criarSupabase(respostaPadrao("ai_processing"));
    mockCreateClient.mockResolvedValue(client);

    const r = await launchScheduledCampaign("camp-1", INICIO);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/IA/);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("recusa publicar uma campanha que já está publicando", async () => {
    const { client, chamadas } = criarSupabase(respostaPadrao("running"));
    mockCreateClient.mockResolvedValue(client);

    const r = await launchScheduledCampaign("camp-1", INICIO);

    expect(r.ok).toBe(false);
    expect(chamadas.some((c) => c.op === "update")).toBe(false);
  });

  it("a virada pra 'running' é presa aos estados publicáveis, não só ao id", async () => {
    const { client, chamadas } = criarSupabase(respostaPadrao("draft"));
    mockCreateClient.mockResolvedValue(client);

    const r = await launchScheduledCampaign("camp-1", INICIO);

    expect(r.ok).toBe(true);
    const virada = chamadas.find(
      (c) => c.table === "mtproto_scheduled_campaigns" && c.payload?.status === "running",
    );
    expect(virada?.filtros.id).toBe("camp-1");
    expect(virada?.filtros.status).toEqual(["draft", "paused", "completed", "failed"]);
  });

  it("CAS perdido no meio (outra aba publicou): recusa como dado, sem dizer que deu certo", async () => {
    const { client } = criarSupabase((ch) => {
      if (ch.table === "mtproto_scheduled_campaigns" && ch.op === "update") {
        return { data: [] }; // nenhuma linha bateu o filtro de estado
      }
      return respostaPadrao("draft")(ch);
    });
    mockCreateClient.mockResolvedValue(client);

    const r = await launchScheduledCampaign("camp-1", INICIO);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Recarregue a página/);
  });

  it("retomada: total_messages soma o que já terminou às pendentes reagendadas", async () => {
    // Sem isso, uma campanha com 4 enviadas e 1 pendente virava
    // total_messages=1 com sent_count=4 — o "5/3 enviadas" do cabeçalho.
    const { client, chamadas } = criarSupabase(respostaPadrao("paused", 4));
    mockCreateClient.mockResolvedValue(client);

    const r = await launchScheduledCampaign("camp-1", INICIO);

    expect(r.ok).toBe(true);
    const virada = chamadas.find(
      (c) => c.table === "mtproto_scheduled_campaigns" && c.payload?.status === "running",
    );
    expect(virada?.payload?.total_messages).toBe(5);
    // E o ciclo novo limpa o desfecho da rodada anterior.
    expect(virada?.payload?.completed_at).toBeNull();
    expect(virada?.payload?.last_error).toBeNull();
  });
});
