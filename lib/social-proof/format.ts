/**
 * Formatação do feed de prova social.
 *
 * Tudo aqui é puro e recebe `now` por parâmetro: o feed é relativo ao momento
 * em que o lead abre o Mini App, então "agora" é entrada, não ambiente.
 *
 * O fuso é fixo em São Paulo. O Mini App renderiza no servidor, e sem fuso fixo
 * a hora exibida seria a do servidor — que pode estar em UTC.
 */

const TZ = "America/Sao_Paulo";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Converte offset em segundos para data absoluta. Nunca retorna futuro. */
export function offsetToDate(offsetSeconds: number, now: Date): Date {
  const safe = Math.max(0, offsetSeconds);
  return new Date(now.getTime() - safe * 1000);
}

/** Partes de data/hora no fuso de Brasília, independente do fuso do servidor. */
function parts(date: Date): { year: number; month: number; day: number; hour: string; minute: string } {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // hourCycle h23 evita "24" à meia-noite em alguns runtimes.
    hour: out.hour === "24" ? "00" : out.hour,
    minute: out.minute,
  };
}

/** Hora no formato do Telegram: 24h, dois dígitos. */
export function formatClock(date: Date): string {
  const p = parts(date);
  return `${p.hour}:${p.minute}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  const pa = parts(a);
  const pb = parts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** "Hoje", "Ontem" ou "12 de agosto". */
export function formatDaySeparator(date: Date, now: Date): string {
  if (isSameDay(date, now)) return "Hoje";

  const ontem = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isSameDay(date, ontem)) return "Ontem";

  const p = parts(date);
  return `${p.day} de ${MESES[p.month - 1]}`;
}

/**
 * Contagem de views no formato do Telegram: 1,2K / 15,3K / 1,2M.
 *
 * Trunca em vez de arredondar — o número mostrado nunca deve ser maior que o
 * real. Vírgula decimal porque o público é pt-BR.
 *
 * Calibração: confirmar contra um canal real no aparelho antes de considerar
 * fechado (spec §6).
 */
export function formatViews(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);

  const unit = v < 1_000_000 ? 1000 : 1_000_000;
  const suffix = unit === 1000 ? "K" : "M";
  const scaled = Math.floor((v / unit) * 10) / 10;
  const whole = Math.floor(scaled);
  const decimal = Math.round((scaled - whole) * 10);

  return decimal === 0 ? `${whole}${suffix}` : `${whole},${decimal}${suffix}`;
}
