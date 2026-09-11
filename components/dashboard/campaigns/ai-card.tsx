import type { ScheduledCampaignAiStatus } from "@/lib/types/database";

const ROTULO: Record<ScheduledCampaignAiStatus, string> = {
  idle: "sem tratamento por IA",
  queued: "na fila para tratamento por IA",
  processing: "IA tratando o conteúdo",
  done: "tratamento por IA concluído",
  partial: "tratamento por IA parcial",
  failed: "tratamento por IA falhou",
};

/**
 * Status do tratamento em LOTE pela IA (Plano 3, Task 2/3 — disparado
 * automaticamente ao importar um clone com `ai_clean`/`ai_rewrite`
 * ligados), mostrado na coluna 1 da campanha.
 *
 * Diferente dos três botões de `CampaignExtras` (assistente SOB DEMANDA,
 * numa mensagem só, chamado pelo dono): este card é só leitura, reflete
 * `mtproto_scheduled_campaigns.ai_status/ai_processed_count/ai_error`, e
 * fica de fora quando a campanha nunca pediu tratamento (`idle` — nasceu
 * vazia ou o clone não tinha nenhuma alavanca de IA marcada).
 */
export function AiCard({
  aiStatus,
  aiProcessedCount,
  totalMessages,
  aiError,
}: {
  aiStatus: ScheduledCampaignAiStatus;
  aiProcessedCount: number;
  totalMessages: number;
  aiError: string | null;
}) {
  if (aiStatus === "idle") return null;

  return (
    <div className="space-y-2 rounded-lg border border-(--border-default) p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-(--text-primary)">Tratamento por IA</p>
        <p className="text-xs text-(--text-muted)">
          {totalMessages > 0 ? `${aiProcessedCount}/${totalMessages}` : ROTULO[aiStatus]}
        </p>
      </div>

      {aiStatus === "processing" && (
        <p className="text-(--text-muted) text-xs">
          A IA está tratando o conteúdo. As mensagens atualizam automaticamente;
          aguarde a conclusão para editar e publicar.
        </p>
      )}

      {aiStatus === "partial" && (
        <p className="text-xs text-(--amber)">
          Só parte das mensagens foi tratada pela IA — o restante ficou exatamente
          como veio da origem. Revise antes de publicar.
        </p>
      )}

      {aiStatus === "done" && (
        <p className="text-xs text-(--text-muted)">
          Tratamento concluído. Confira o resultado nas mensagens antes de publicar.
        </p>
      )}

      {aiStatus === "failed" && (
        <p className="text-xs text-(--red)">
          {aiError ?? "O tratamento por IA falhou. As mensagens continuam como vieram da origem."}
        </p>
      )}
    </div>
  );
}
