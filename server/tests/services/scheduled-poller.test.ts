import { describe, it, expect } from "vitest";
import {
  tickCampanhasAgendadas,
  type PollerDeps,
} from "../../src/workers/scheduled-campaign-handler.js";

const AGORA = new Date("2026-09-10T12:00:00.000Z");

/**
 * Mini-banco que honra o CONTRATO das consultas do poller (queue.ts), pra a
 * decisão do tick ser exercitada sem Postgres nem Redis:
 *
 * - `campanhasRodando` devolve as 'running' da mais antiga pra mais nova,
 *   cortadas no limite — é o `order by started_at, created_at limit N` de lá;
 * - uma campanha sem pendente nenhuma já não está 'running' (o handler a marca
 *   'completed' quando não sobra nada), então some da consulta;
 * - `comEnvioEmVoo` devolve quem tem mensagem em 'sending'.
 */
interface CampanhaFake {
  id: string;
  /** Quanto MENOR, mais antiga — só a ordem importa. */
  startedAt: number;
  pendentes: string[];
  emVoo?: boolean;
}

function criarDeps(campanhas: CampanhaFake[]): {
  deps: PollerDeps;
  enfileiradas: string[];
  vencidasConsultadas: string[];
  limitesPedidos: number[];
} {
  const enfileiradas: string[] = [];
  const vencidasConsultadas: string[] = [];
  const limitesPedidos: number[] = [];
  const deps: PollerDeps = {
    campanhasRodando: async (limite) => {
      limitesPedidos.push(limite);
      return campanhas
        .filter((c) => c.pendentes.length > 0)
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(0, limite)
        .map((c) => c.id);
    },
    comEnvioEmVoo: async (ids) =>
      campanhas.filter((c) => ids.includes(c.id) && c.emVoo === true).map((c) => c.id),
    proximaVencida: async (campaignId) => {
      vencidasConsultadas.push(campaignId);
      return campanhas.find((c) => c.id === campaignId)?.pendentes[0] ?? null;
    },
    enfileirar: async (messageId) => {
      enfileiradas.push(messageId);
    },
  };
  return { deps, enfileiradas, vencidasConsultadas, limitesPedidos };
}

describe("tickCampanhasAgendadas", () => {
  it("pula a campanha que já tem mensagem em voo, mesmo com outra vencida", async () => {
    // O caso que 'uma por tick' não cobria: a publicação anterior demorou mais
    // que o intervalo, saiu de 'pending' e sumiu da consulta — sem esta guarda
    // a segunda entraria por cima e, com concurrency 4, publicaria antes.
    const { deps, enfileiradas, vencidasConsultadas } = criarDeps([
      { id: "ocupada", startedAt: 1, pendentes: ["m2"], emVoo: true },
      { id: "livre", startedAt: 2, pendentes: ["m9"] },
    ]);

    const r = await tickCampanhasAgendadas(deps, AGORA, 10);

    expect(r.puladas).toEqual(["ocupada"]);
    expect(enfileiradas).toEqual(["m9"]);
    // Nem chega a perguntar o que venceu na campanha ocupada.
    expect(vencidasConsultadas).toEqual(["livre"]);
  });

  it("campanha sem nada em voo e com mensagem vencida enfileira exatamente uma", async () => {
    const { deps, enfileiradas } = criarDeps([
      { id: "c1", startedAt: 1, pendentes: ["m1", "m2", "m3"] },
    ]);

    const r = await tickCampanhasAgendadas(deps, AGORA, 10);

    expect(enfileiradas).toEqual(["m1"]);
    expect(r.enfileiradas).toEqual(["m1"]);
    expect(r.puladas).toEqual([]);
  });

  it("campanha sem nada vencido não enfileira e não é contada como pulada", async () => {
    const { deps, enfileiradas } = criarDeps([{ id: "c1", startedAt: 1, pendentes: [] }]);

    const r = await tickCampanhasAgendadas(deps, AGORA, 10);

    expect(enfileiradas).toEqual([]);
    expect(r).toEqual({ enfileiradas: [], puladas: [] });
  });

  it("respeita a ordem da página: enfileira da campanha mais antiga pra mais nova", async () => {
    const { deps, enfileiradas, limitesPedidos } = criarDeps([
      { id: "nova", startedAt: 30, pendentes: ["n1"] },
      { id: "antiga", startedAt: 10, pendentes: ["a1"] },
      { id: "meio", startedAt: 20, pendentes: ["x1"] },
    ]);

    await tickCampanhasAgendadas(deps, AGORA, 10);

    expect(enfileiradas).toEqual(["a1", "x1", "n1"]);
    expect(limitesPedidos).toEqual([10]);
  });

  it("com mais campanhas que o limite da página, todas são alcançadas ao longo dos ticks", async () => {
    // Starvation: com `limit` e sem ordem, o Postgres pode devolver as mesmas
    // N para sempre e o excedente nunca publica. Pela mais antiga primeiro a
    // fila drena — quem começou antes acaba antes, sai de 'running' e abre a
    // vaga. Aqui o limite é 2 e há 5 campanhas de uma mensagem cada.
    const campanhas: CampanhaFake[] = [
      { id: "c1", startedAt: 1, pendentes: ["m1"] },
      { id: "c2", startedAt: 2, pendentes: ["m2"] },
      { id: "c3", startedAt: 3, pendentes: ["m3"] },
      { id: "c4", startedAt: 4, pendentes: ["m4"] },
      { id: "c5", startedAt: 5, pendentes: ["m5"] },
    ];
    const { deps, enfileiradas } = criarDeps(campanhas);

    for (let tick = 0; tick < 3; tick++) {
      const r = await tickCampanhasAgendadas(deps, AGORA, 2);
      // Simula o worker publicando o que foi enfileirado neste tick.
      for (const messageId of r.enfileiradas) {
        for (const c of campanhas) {
          c.pendentes = c.pendentes.filter((p) => p !== messageId);
        }
      }
    }

    expect(enfileiradas).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(campanhas.every((c) => c.pendentes.length === 0)).toBe(true);
  });
});
