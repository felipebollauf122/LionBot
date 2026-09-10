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
 * - uma campanha sai da consulta quando é ASSENTADA (levada pra
 *   completed/failed), nunca antes: enquanto estiver 'running' ela ocupa uma
 *   das vagas da página, tenha fila ou não — que é justamente o defeito que
 *   `assentar` fecha;
 * - `comEnvioEmVoo` devolve quem tem mensagem em 'sending';
 * - `comFilaPendente` devolve quem ainda tem pendente AGENDADA (o
 *   `scheduled_at not null` de lá), que é coisa diferente de "vencida agora".
 */
interface CampanhaFake {
  id: string;
  /** Quanto MENOR, mais antiga — só a ordem importa. */
  startedAt: number;
  /** Pendentes AGENDADAS, na ordem de publicação. */
  pendentes: string[];
  /** false = tem fila, mas nenhuma venceu ainda (espera até o próximo horário). */
  algumaVencida?: boolean;
  emVoo?: boolean;
  /** Já levada pra completed/failed: sai da consulta de 'running'. */
  assentada?: boolean;
}

function criarDeps(campanhas: CampanhaFake[]): {
  deps: PollerDeps;
  enfileiradas: string[];
  vencidasConsultadas: string[];
  limitesPedidos: number[];
  assentadas: string[];
} {
  const enfileiradas: string[] = [];
  const vencidasConsultadas: string[] = [];
  const limitesPedidos: number[] = [];
  const assentadas: string[] = [];
  const deps: PollerDeps = {
    campanhasRodando: async (limite) => {
      limitesPedidos.push(limite);
      return campanhas
        .filter((c) => !c.assentada)
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(0, limite)
        .map((c) => c.id);
    },
    comEnvioEmVoo: async (ids) =>
      campanhas.filter((c) => ids.includes(c.id) && c.emVoo === true).map((c) => c.id),
    comFilaPendente: async (ids) =>
      campanhas.filter((c) => ids.includes(c.id) && c.pendentes.length > 0).map((c) => c.id),
    proximaVencida: async (campaignId) => {
      vencidasConsultadas.push(campaignId);
      const c = campanhas.find((x) => x.id === campaignId);
      if (!c || c.algumaVencida === false) return null;
      return c.pendentes[0] ?? null;
    },
    enfileirar: async (messageId) => {
      enfileiradas.push(messageId);
    },
    assentar: async (campaignId) => {
      assentadas.push(campaignId);
      const c = campanhas.find((x) => x.id === campaignId);
      if (c) c.assentada = true;
    },
  };
  return { deps, enfileiradas, vencidasConsultadas, limitesPedidos, assentadas };
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

  it("campanha com fila mas nada vencido não enfileira, não é pulada e NÃO é assentada", async () => {
    // Espera até o próximo horário não é fim de campanha. Assentar aqui
    // encerraria toda campanha no intervalo entre uma postagem e a seguinte.
    const { deps, enfileiradas, assentadas } = criarDeps([
      { id: "c1", startedAt: 1, pendentes: ["m1"], algumaVencida: false },
    ]);

    const r = await tickCampanhasAgendadas(deps, AGORA, 10);

    expect(enfileiradas).toEqual([]);
    expect(assentadas).toEqual([]);
    expect(r).toEqual({ enfileiradas: [], puladas: [], assentadas: [] });
  });

  it("campanha em curso que ficou sem fila nenhuma é assentada e libera a vaga", async () => {
    // O defeito: `concluirSeUltima` só era chamada por um envio ou uma falha.
    // Apagar a última pendente de uma campanha em curso a deixava 'running'
    // PRA SEMPRE — e como a página é ordenada por started_at crescente, ela
    // ficava no topo de uma janela de 50 vagas, matando de fome os outros
    // tenants.
    const { deps, enfileiradas, assentadas, vencidasConsultadas } = criarDeps([
      { id: "vazia", startedAt: 1, pendentes: [] },
      { id: "viva", startedAt: 2, pendentes: ["m1"] },
    ]);

    const r = await tickCampanhasAgendadas(deps, AGORA, 10);

    expect(assentadas).toEqual(["vazia"]);
    expect(r.assentadas).toEqual(["vazia"]);
    // Assentar não é "pular": a vaga foi liberada de verdade.
    expect(r.puladas).toEqual([]);
    // E nem chega a perguntar o que venceu numa campanha sem fila.
    expect(vencidasConsultadas).toEqual(["viva"]);
    expect(enfileiradas).toEqual(["m1"]);
  });

  it("campanha vazia mas com envio em voo é pulada, não assentada", async () => {
    // A última mensagem ainda está sendo publicada: encerrar agora escreveria
    // o desfecho antes de saber se ela deu certo.
    const { deps, assentadas } = criarDeps([
      { id: "ultima", startedAt: 1, pendentes: [], emVoo: true },
    ]);

    const r = await tickCampanhasAgendadas(deps, AGORA, 10);

    expect(assentadas).toEqual([]);
    expect(r.puladas).toEqual(["ultima"]);
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
          // O próprio worker assenta a campanha ao publicar a última
          // (assentarCampanhaSeVazia no fim de handleScheduledSend); o
          // poller é só a rede de segurança pros outros caminhos.
          if (c.pendentes.length === 0) c.assentada = true;
        }
      }
    }

    expect(enfileiradas).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(campanhas.every((c) => c.pendentes.length === 0)).toBe(true);
  });
});
