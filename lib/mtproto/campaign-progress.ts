export interface CampaignProgressSource {
  status: string;
  total_targets: number;
  sent_count: number;
  failed_count: number;
  skipped_count?: number | null;
  is_processing?: boolean;
  processing_started_at?: string | null;
  next_run_at?: string | null;
}

export function campaignProgress(c: CampaignProgressSource, now = Date.now()) {
  const skipped = c.skipped_count ?? 0;
  const pending = Math.max(0, c.total_targets - c.sent_count - c.failed_count);
  const total = c.total_targets + skipped;
  const processed = c.sent_count + c.failed_count + skipped;
  let label = "Rascunho";
  let description = "Pronto para iniciar quando você quiser.";
  if (c.status === "running") {
    const heartbeat = c.processing_started_at ? Date.parse(c.processing_started_at) : 0;
    label = c.is_processing && heartbeat > now - 120_000 ? "Enviando" : "Recuperando envio";
    description = label === "Enviando" ? "O envio continua em segundo plano. Você pode sair desta tela." : "A recuperação automática vai recolocar este disparo na fila.";
  } else if (c.status === "scheduled") {
    label = pending > 0 ? "Aguardando retomada" : "Entre ciclos";
    description = pending > 0 ? "Os destinos pendentes estão preservados para a próxima tentativa." : "O próximo ciclo começa no horário programado.";
  } else if (c.status === "paused") {
    label = "Pausado por você";
    description = "Nenhuma retomada automática. Clique em Retomar para continuar.";
  } else if (c.status === "completed") {
    label = "Ciclo concluído";
    description = "Todos os destinos deste ciclo foram processados.";
  } else if (c.status === "failed") {
    label = "Precisa de atenção";
    description = "Confira os motivos abaixo antes de retomar.";
  }
  return { total, pending, skipped, processed, percent: total ? Math.min(100, Math.round(processed / total * 100)) : 0, label, description };
}
