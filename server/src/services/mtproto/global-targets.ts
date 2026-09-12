/**
 * Monta as linhas de mtproto_targets de uma campanha global a partir dos
 * dialogs da(s) conta(s). Usado pelos dois rebuilds do worker (hot-add e
 * refresh); app/dashboard/automations/actions.ts espelha a mesma regra na
 * criação (módulo "use server" não importa daqui).
 *
 * Dialog bloqueado NÃO fica de fora em silêncio: entra como 'skipped' com o
 * motivo, pra tela mostrar "Pulados N" e por quê. Fora do total (trigger da
 * migration 083), então não trava a barra de progresso nem vira falha.
 *
 * send_refusal (o Telegram recusou um envio de verdade) vence write_block (o
 * que as permissões da sincronização sugerem): é a evidência mais forte.
 */
export interface GlobalDialogRow {
  id: string;
  account_id: string;
  title: string | null;
  username: string | null;
  write_block: string | null;
  send_refusal: string | null;
}

export interface GlobalTargetRow {
  campaign_id: string;
  target_identifier: string;
  target_type: "username";
  status: "pending" | "skipped";
  error_message: string | null;
  dialog_id: string;
  account_id: string;
}

export function buildGlobalTargetRows(
  campaignId: string,
  dialogs: GlobalDialogRow[],
): GlobalTargetRow[] {
  return dialogs.map((d) => {
    const block = d.send_refusal ?? d.write_block;
    return {
      campaign_id: campaignId,
      target_identifier: d.username ?? d.title ?? d.id,
      target_type: "username",
      status: block ? "skipped" : "pending",
      error_message: block,
      dialog_id: d.id,
      account_id: d.account_id,
    };
  });
}
