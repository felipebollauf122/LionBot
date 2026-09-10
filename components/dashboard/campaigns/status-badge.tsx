import type { ScheduledMessageStatus } from "@/lib/types/database";

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

/** Chip de status de envio de uma mensagem — usado no badge por bolha do
 *  preview (`messageBadge` do ComposerShell). */
export function StatusBadge({ status }: { status: ScheduledMessageStatus }) {
  const info = ROTULO[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${info.classe}`}
    >
      {info.texto}
    </span>
  );
}
