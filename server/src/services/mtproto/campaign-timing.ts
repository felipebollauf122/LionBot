/** Intervalo entre inícios, sem sobrepor ciclos nem acrescentar a duração do envio. */
export function nextCampaignRun(startedAt: string | null, seconds: number, now = Date.now()): string {
  const start = startedAt ? Date.parse(startedAt) : now;
  return new Date(Math.max(now, (Number.isFinite(start) ? start : now) + seconds * 1000)).toISOString();
}
