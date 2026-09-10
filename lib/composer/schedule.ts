/**
 * Cálculo do agendamento absoluto a partir dos delays relativos.
 *
 * Vive aqui e não na Server Action por duas razões: um módulo "use server" só
 * exporta função async (mesmo motivo que tirou os tipos da Prova Social pra
 * lib/social-proof/types.ts), e a MESMA função alimenta a prévia da tela, que
 * mostra "última postagem cai em…" antes de qualquer gravação.
 */

export interface SchedulableRow {
  id: string;
  /** Espera, em segundos, DEPOIS da mensagem anterior. */
  delay_seconds: number;
  ai_discarded: boolean;
}

export function accumulateSchedule(
  rows: SchedulableRow[],
  startAt: Date,
): Array<{ id: string; scheduledAt: Date }> {
  const out: Array<{ id: string; scheduledAt: Date }> = [];
  let cursor = startAt.getTime();
  let primeira = true;

  for (const row of rows) {
    // Descartada não vai ao ar, então também não consome o próprio delay:
    // somá-lo abriria um buraco na cadência que ninguém pediu.
    if (row.ai_discarded) continue;

    if (primeira) {
      // A primeira sai no horário de início. O delay de uma mensagem é o que
      // se espera ANTES dela contado da anterior — a primeira não tem anterior.
      primeira = false;
    } else {
      cursor += Math.max(0, row.delay_seconds) * 1000;
    }
    out.push({ id: row.id, scheduledAt: new Date(cursor) });
  }

  return out;
}

/** Uma linha da campanha do ponto de vista do tempo. */
export interface TimelineRow extends SchedulableRow {
  /** Horário absoluto já gravado. Nulo enquanto a campanha não foi publicada. */
  scheduled_at: string | null;
}

/**
 * Âncora e distâncias da prévia da campanha.
 *
 * O `FeedPreview` desenha tudo a partir de "há quantos segundos", e
 * `offsetToDate` NUNCA devolve futuro (`Math.max(0, …)`, travado por dois
 * testes — é decisão da Prova Social, onde uma mensagem com hora futura
 * denunciaria a simulação na hora). Ancorar em `Date.now()` faria toda
 * campanha ainda não publicada — offsets negativos — colapsar no horário
 * atual, todas as bolhas na mesma hora e um "Hoje" só.
 *
 * Por isso a âncora é o ÚLTIMO momento da sequência, e não o agora: assim
 * todo offset é ≥ 0, nada é aparado, e espaçamento, relógio e separadores de
 * dia saem certos, com as datas reais na tela. A última bolha lendo "agora" é
 * a consequência honesta de ancorar ali.
 *
 * O momento de cada linha é o `scheduled_at` real quando existe (campanha já
 * publicada) e a projeção de `accumulateSchedule` quando não (rascunho) — a
 * MESMA função que o worker usa, nunca uma soma feita à mão. Linha por linha,
 * e não pelo status da campanha: uma campanha pausada que ganhou mensagem
 * nova tem os dois casos ao mesmo tempo.
 *
 * Uma linha descartada não entra na projeção — ela não vai ao ar — e fica no
 * momento da anterior, que é onde ela está na fila.
 */
export function campaignTimeline(
  rows: TimelineRow[],
  startAt: Date,
): { anchor: Date; offsetSeconds: Map<string, number> } {
  const inicio = Number.isNaN(startAt.getTime()) ? new Date() : startAt;

  const projecao = new Map(
    accumulateSchedule(rows, inicio).map((i) => [i.id, i.scheduledAt.getTime()]),
  );

  const momentos = new Map<string, number>();
  let ancora = inicio.getTime();
  let anterior = inicio.getTime();

  for (const row of rows) {
    const real = row.scheduled_at ? new Date(row.scheduled_at).getTime() : Number.NaN;
    const momento = Number.isNaN(real) ? (projecao.get(row.id) ?? anterior) : real;
    momentos.set(row.id, momento);
    anterior = momento;
    if (momento > ancora) ancora = momento;
  }

  const offsetSeconds = new Map<string, number>();
  for (const [id, momento] of momentos) {
    offsetSeconds.set(id, Math.max(0, Math.round((ancora - momento) / 1000)));
  }

  return { anchor: new Date(ancora), offsetSeconds };
}
