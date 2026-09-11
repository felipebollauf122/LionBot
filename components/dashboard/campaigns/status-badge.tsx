import type { ScheduledMessageStatus } from "@/lib/types/database";
import { messageFloodHint } from "@/lib/composer/flood-wait";
import { describeSendError } from "@/lib/composer/message-error";

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
 * (`mtproto_scheduled_messages.error_message`/`scheduled_at`) — ausentes, o
 * chip continua exatamente como antes (nenhum `title`).
 *
 * O `title` (hover) NUNCA mostra `error_message` cru. Quando é uma espera de
 * limite do Telegram, o hover explica em português simples (via
 * `messageFloodHint`) e o chip troca pra amber. Qualquer outro erro passa
 * por `describeSendError`, que reconhece as causas que o worker documenta e
 * cai numa frase neutra em português pra qualquer coisa não reconhecida —
 * inclusive o texto cru do Telegram/Bot API, tipicamente em inglês, que o
 * worker às vezes grava direto (`err.message`). Diferente de
 * `ensureBotAccess`: ali o dono pode AGIR a partir do erro cru (mudar uma
 * config no BotFather); aqui não há ação nenhuma que o texto técnico
 * habilite, só confusão. O texto cru continua acessível, só que discreto —
 * `data-raw-error`, não o `title`.
 *
 * `now` (opcional, default o agora real) só importa pro caso de flood: é a
 * referência pra decidir se o dia entra na frase.
 */
export function StatusBadge({
  status,
  errorMessage = null,
  scheduledAt = null,
  now,
}: {
  status: ScheduledMessageStatus;
  errorMessage?: string | null;
  scheduledAt?: string | null;
  now?: Date;
}) {
  const info = ROTULO[status];
  const floodHint = messageFloodHint(errorMessage, scheduledAt, now);
  const sendErrorHint = floodHint ? null : describeSendError(errorMessage);
  const title = floodHint ?? sendErrorHint ?? undefined;
  const classe = floodHint ? CLASSE_FLOOD : info.classe;

  return (
    <span
      title={title}
      data-raw-error={!floodHint && errorMessage ? errorMessage : undefined}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${classe}`}
    >
      {floodHint ? "aguardando limite" : info.texto}
    </span>
  );
}
