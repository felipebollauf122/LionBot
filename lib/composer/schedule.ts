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
