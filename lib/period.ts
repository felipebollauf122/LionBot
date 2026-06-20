// Lógica de período em DIAS-CALENDÁRIO de Brasília — compartilhada entre o
// filtro (cliente) e a agregação. Trabalha com strings "YYYY-MM-DD" (dia BRT),
// então não tem confusão de fuso: comparação de string de data já basta.

export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";

const BR_OFFSET_MIN = 180;

/** Dia-calendário (YYYY-MM-DD) de "agora" em Brasília. */
export function todayKeyBR(now: Date = new Date()): string {
  return new Date(now.getTime() - BR_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Soma `n` dias a um "YYYY-MM-DD" e devolve outro "YYYY-MM-DD". */
function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Intervalo [from, to] inclusivo em dias BRT (strings YYYY-MM-DD) para um período.
 * `from`/`to` null = sem limite daquele lado (ex: "all").
 */
export function periodDayRange(
  period: PeriodKey,
  opts?: { startDate?: string; endDate?: string; now?: Date },
): { from: string | null; to: string | null } {
  const today = todayKeyBR(opts?.now);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "custom":
      return { from: opts?.startDate || null, to: opts?.endDate || null };
    case "all":
    default:
      return { from: null, to: null };
  }
}

/** Um dia "YYYY-MM-DD" está dentro do intervalo? */
export function dayInRange(date: string, range: { from: string | null; to: string | null }): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
