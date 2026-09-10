import type { ScheduledMessageStatus } from "@/lib/types/database";
import { messageFloodHint } from "@/lib/composer/flood-wait";

/** Não existe token `--green` em app/globals.css — `--cyan` é o que o
 *  projeto já usa pra "sucesso/enviado" (ver o badge de alvo `sent` em
 *  components/dashboard/mtproto-campaign-detail.tsx). */
const ROTULO: Record<ScheduledMessageStatus, { texto: string; classe: string }> = {
  pending: { texto: "pendente", classe: "text-(--text-muted) border-(--border-subtle)" },
  sending: { texto: "enviando", classe: "text-(--accent) border-(--accent)" },
  sent: { texto: "enviada", classe: "text-(--cyan) border-(--cyan)" },
  failed: { texto: "falhou", classe: "text-(--red) border-(--red)" },
  skipped: {
    texto: "descartada",
    classe: "text-(--text-muted) border-dashed border-(--border-default)",
  },
};

/** Chip amber por cima do rótulo normal quando a linha está esperando o
 *  limite do Telegram — visualmente distinta de "pendente" comum, porque a
 *  espera não é uma fila normal, é uma pausa forçada. */
const CLASSE_FLOOD = "text-(--amber) border-(--amber)";

/**
 * Chip de status de envio de uma mensagem — usado no badge por bolha do
 * preview (`messageBadge` do ComposerShell).
 *
 * `errorMessage`/`scheduledAt` são opcionais e vêm da linha real
 * (`mtproto_scheduled_messages.error_message`/`scheduled_at`) — ausentes,
 * o chip continua exatamente como antes (nenhum `title`). Quando a linha
 * carrega um `error_message` no formato `flood_wait_<N>s` do worker, o chip
 * troca de cor pra amber e ganha um `title` (hover) explicando em português
 * simples: o limite é do Telegram, não um erro da campanha, e quando volta.
 * Qualquer outro `error_message` (falha real, retry em curso) aparece no
 * hover por inteiro — mesma lógica de `ensureBotAccess`: erro sem causa
 * conhecida some no `title` cru, nunca é escondido atrás de um texto
 * genérico.
 */
export function StatusBadge({
  status,
  errorMessage = null,
  scheduledAt = null,
}: {
  status: ScheduledMessageStatus;
  errorMessage?: string | null;
  scheduledAt?: string | null;
}) {
  const info = ROTULO[status];
  const floodHint = messageFloodHint(errorMessage, scheduledAt);
  const title = floodHint ?? errorMessage ?? undefined;
  const classe = floodHint ? CLASSE_FLOOD : info.classe;

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${classe}`}
    >
      {floodHint ? "aguardando limite" : info.texto}
    </span>
  );
}
