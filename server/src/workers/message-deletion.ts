import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deleção agendada das mensagens do bot.
 *
 * Dois caminhos, de propósito:
 *
 * 1. CAMINHO NORMAL — um job BullMQ por mensagem, com o delay exato escolhido
 *    no bloco. É ele quem cumpre "apagar em 10s", com precisão de
 *    milissegundos (mesmo mecanismo do bloco de Delay do fluxo).
 * 2. REDE DE SEGURANÇA — `processOverdueDeletions`, que varre a tabela atrás
 *    do que venceu e ninguém apagou (Redis reiniciado, job perdido, servidor
 *    fora do ar na hora marcada). Só olha o que já passou do prazo há bastante
 *    tempo, pra nunca competir com o job que ainda vai disparar.
 */

export interface MessageDeletionData {
  queueRowId: string;
  botToken: string;
  chatId: number;
  messageId: number;
}

export interface MessageDeletionDeps {
  db: SupabaseClient;
  deleteMessage(botToken: string, chatId: number, messageId: number): Promise<boolean>;
}

/**
 * Folga antes de a rede de segurança assumir uma linha. Tem que ser maior que
 * qualquer atraso normal do BullMQ — abaixo disso, poller e job apagariam a
 * mesma mensagem em paralelo.
 */
export const OVERDUE_GRACE_SECONDS = 120;

/** Quantas linhas atrasadas a rede de segurança leva por rodada. */
const OVERDUE_BATCH_SIZE = 200;

/** Deleções simultâneas — o Telegram limita a ~30 chamadas/s por bot. */
const CONCURRENCY = 10;

/** Executa uma deleção e registra o desfecho na `message_delete_queue`. */
export async function runMessageDeletion(
  deps: MessageDeletionDeps,
  data: MessageDeletionData,
): Promise<void> {
  const ok = await deps.deleteMessage(data.botToken, data.chatId, data.messageId);

  if (ok) {
    await deps.db
      .from("message_delete_queue")
      .update({ status: "deleted" })
      .eq("id", data.queueRowId);
    return;
  }

  // `.eq("status", "pending")`: se a outra ponta (job ou rede de segurança) já
  // apagou esta mensagem, o "failed" daqui é só o eco da corrida — não pode
  // rebaixar uma linha que já está marcada como deletada.
  await deps.db
    .from("message_delete_queue")
    .update({
      status: "failed",
      error_message: "Failed to delete message via Telegram API",
    })
    .eq("id", data.queueRowId)
    .eq("status", "pending");
}

/**
 * Varre a tabela atrás de deleções vencidas que o job agendado não cumpriu.
 * Retorna quantas linhas processou.
 */
export async function processOverdueDeletions(deps: MessageDeletionDeps): Promise<number> {
  const cutoff = new Date(Date.now() - OVERDUE_GRACE_SECONDS * 1000).toISOString();

  const { data: rows, error } = await deps.db
    .from("message_delete_queue")
    .select("id, bot_token, chat_id, message_id")
    .eq("status", "pending")
    .lte("delete_at", cutoff)
    // Mais antigas primeiro: sem isso, um backlog acima do limite do lote
    // devolvia linhas em ordem arbitrária e as novas ficavam para trás
    // indefinidamente.
    .order("delete_at", { ascending: true })
    .limit(OVERDUE_BATCH_SIZE);

  if (error || !rows || rows.length === 0) return 0;

  console.log(`[auto-delete] Rede de segurança: ${rows.length} deleções atrasadas`);

  // Em blocos paralelos — em série, um lote grande levava mais tempo que o
  // próprio intervalo de varredura.
  const list = rows as { id: string; bot_token: string; chat_id: number; message_id: number }[];
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    await Promise.all(
      list.slice(i, i + CONCURRENCY).map((row) =>
        runMessageDeletion(deps, {
          queueRowId: row.id,
          botToken: row.bot_token,
          chatId: row.chat_id,
          messageId: row.message_id,
        }).catch((err) => console.error(`[auto-delete] Erro na linha ${row.id}:`, err)),
      ),
    );
  }

  return list.length;
}
