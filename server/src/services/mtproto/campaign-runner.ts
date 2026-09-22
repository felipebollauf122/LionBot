import type { AccountPool } from "./pool.js";
import { extractWaitSeconds } from "./flood.js";
import { transientCampaignError } from "./campaign-recovery.js";
import { classifyUnwritable, type UnwritableReason } from "./unwritable.js";

export interface CampaignTargetRow {
  id: string;
  identifier: string;
  type: "username" | "phone";
  status: "pending" | "sent" | "failed" | "skipped";
  /**
   * Quando setado, o runner ignora identifier/type e envia direto pro peer
   * via sendMessageToPeer do MtprotoClient (mais barato e seguro — não tenta
   * resolveUsername nem importContacts).
   */
  dialog?: {
    peerId: string;
    peerType: "user" | "chat" | "channel";
    peerAccessHash: string | null;
    /** Grupo em modo fórum: precisa de tópico (ver forum-fallback.ts). */
    isForum?: boolean;
    /** Tópico já escolhido num envio anterior; null = General. */
    forumTopicId?: number | null;
  };
  /**
   * Id da linha em mtproto_dialogs que originou este target (quando veio da
   * sincronização, não de lista colada). O runner não usa pra enviar — quem
   * usa é o skipTarget, pra marcar o dialog e ele não voltar no próximo
   * rebuild da campanha global.
   */
  dialogId?: string;
  /**
   * Quando setado, força essa conta específica a enviar (ignora round-robin
   * do pool). Usado em campanhas globais — cada target já vem com a conta
   * dona do dialog. Se a conta estiver indisponível (flood_wait/banned), o
   * target é pulado naquele tick e retentado depois.
   */
  pinnedAccountId?: string;
}

/**
 * Contadores (sent_count/failed_count/skipped_count/total_targets) NÃO são
 * escritos pelo runner: a migration 083 os recalcula por trigger a partir das
 * linhas de mtproto_targets a cada mudança. Cada dep abaixo só muda a linha
 * do alvo; a contagem segue sozinha.
 */
export interface RunnerDeps {
  prepareTarget?: (target: CampaignTargetRow, accountId: string) => Promise<void>;
  deferCampaign?: (until: string, reason: string) => Promise<void>;
  deferAccount?: (accountId: string, until: string, reason: string) => Promise<void>;
  hasPendingTargets?: () => Promise<boolean>;
  sendMessage: (
    accountId: string,
    target: CampaignTargetRow,
    text: string,
  ) => Promise<void>;
  markTargetSent: (targetId: string, accountId: string) => Promise<void>;
  markTargetFailed: (targetId: string, accountId: string | null, error: string) => Promise<void>;
  /**
   * Marca um target pinned pra retry depois de FLOOD_WAIT (#47): mantém
   * status='pending' mas seta retry_after, pra não perder o lead. Se a dep
   * não for fornecida, cai no markTargetFailed (comportamento antigo).
   */
  markTargetRetryAfter?: (targetId: string, retryAfterIso: string, reason?: string) => Promise<void>;
  /**
   * Pula o alvo: destino que NUNCA vai aceitar a mensagem desta conta (canal
   * sem admin, conta silenciada/banida ali, chat restrito, fórum fechado...
   * — a lista fechada está em unwritable.ts). Não é falha: vira
   * status='skipped' com o código como motivo, fora do total, e o dialog é
   * marcado pra não voltar no próximo rebuild da campanha global.
   *
   * Se a dep não for fornecida, o erro cai no markTargetFailed normal.
   */
  skipTarget?: (
    targetId: string,
    target: CampaignTargetRow,
    reason: UnwritableReason,
  ) => Promise<void>;
  setCampaignStatus: (
    campaignId: string,
    status: "running" | "paused" | "completed" | "failed",
  ) => Promise<void>;
  /**
   * Lê status atual da campanha no DB. Runner usa pra abortar mid-loop
   * caso o usuário pause manualmente pela UI.
   */
  getCampaignStatus: (campaignId: string) => Promise<string | null>;
  /**
   * Re-busca targets pending no DB. Usado quando o runner termina o
   * snapshot atual — se contas novas foram adicionadas à campanha global
   * enquanto o runner rodava, esses targets recém-inseridos aparecem aqui
   * e o runner continua processando sem precisar enfileirar novo job.
   */
  refetchPending?: (campaignId: string) => Promise<CampaignTargetRow[]>;
  /**
   * Recarrega contas no pool. Quando uma conta nova é conectada no meio
   * de uma campanha global, ela vira disponível pra enviar os próprios
   * targets pinned.
   */
  reloadPool?: () => Promise<void>;
  /**
   * Marca a conta como banida/inválida no DB (status='banned' + last_error).
   * Chamado quando o Telegram retorna AUTH_KEY_UNREGISTERED, USER_DEACTIVATED,
   * SESSION_REVOKED ou PHONE_NUMBER_BANNED. Próximas campanhas pulam essa
   * conta automaticamente até o owner relogar pelo bot/dashboard.
   */
  markAccountFatal?: (accountId: string, error: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
}

export interface CampaignConfig {
  campaignId: string;
  messageText: string;
  delayMinSeconds: number;
  delayMaxSeconds: number;
  recurrenceSeconds?: number | null;
}

// (?<!INPUT_): INPUT_USER_DEACTIVATED é o CONTATO que desativou a conta dele —
// recusa do destino, não sessão morta da nossa conta. Sem o lookbehind,
// um contato desativado derrubava a conta inteira como "banida".
function isFatalAccountError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /AUTH_KEY|(?<!INPUT_)USER_DEACTIVATED|SESSION_REVOKED|PHONE_NUMBER_BANNED/i.test(msg);
}

export class CampaignRunner {
  private yielded = false;
  private needsSpacing = false;

  private retrySeconds(): number {
    return Math.max(1, this.cfg.recurrenceSeconds ?? this.cfg.delayMinSeconds);
  }
  constructor(
    private pool: AccountPool,
    private deps: RunnerDeps,
    private cfg: CampaignConfig,
  ) {}

  async run(targets: CampaignTargetRow[]): Promise<void> {
    const initialStatus = await this.deps.getCampaignStatus(this.cfg.campaignId);
    if (initialStatus === null || initialStatus === "paused" || initialStatus === "failed" || initialStatus === "completed") return;
    await this.deps.setCampaignStatus(this.cfg.campaignId, "running");

    // Loop externo: drena os pending; ao acabar o snapshot, re-consulta o
    // DB pra ver se novos targets foram adicionados (caso típico: conta
    // nova conectada no meio do run de uma campanha global). Sai apenas
    // quando refetch retornar vazio (ou se deps não suportar refetch).
    let currentBatch = targets.filter((t) => t.status === "pending");
    let drained = false;
    while (!drained) {
      await this.processBatch(currentBatch);
      if (this.yielded) return;
      // Tenta re-buscar se a campanha ainda está running.
      // status=null = campanha deletada pelo user → aborta sem completar.
      const liveStatus = await this.deps.getCampaignStatus(this.cfg.campaignId);
      if (liveStatus === null) {
        console.log(`[runner] campaign ${this.cfg.campaignId} sumiu do DB (deletada), abortando`);
        return;
      }
      if (liveStatus === "paused" || liveStatus === "failed") {
        return;
      }
      if (!this.deps.refetchPending) {
        drained = true;
        break;
      }
      if (this.deps.reloadPool) await this.deps.reloadPool();
      const next = await this.deps.refetchPending(this.cfg.campaignId);
      if (next.length === 0) {
        drained = true;
      } else {
        console.log(
          `[runner] campaign ${this.cfg.campaignId}: ${next.length} novos targets pending detectados (provavelmente conta nova conectada), continuando...`,
        );
        currentBatch = next;
      }
    }

    if (this.deps.hasPendingTargets && await this.deps.hasPendingTargets()) {
      await this.defer(this.retrySeconds(), "WAITING_RETRY");
      return;
    }
    await this.deps.setCampaignStatus(this.cfg.campaignId, "completed");
  }

  private async defer(seconds: number, reason: string, target?: CampaignTargetRow, accountId?: string): Promise<void> {
    const until = new Date(Date.now() + seconds * 1000).toISOString();
    if (accountId && this.deps.deferAccount) await this.deps.deferAccount(accountId, until, reason);
    if (target && this.deps.markTargetRetryAfter) await this.deps.markTargetRetryAfter(target.id, until, reason);
    this.yielded = true;
    await this.deps.deferCampaign?.(until, reason);
  }

  /**
   * Recusa permanente do destino (unwritable.ts): é permissão DO CHAT ou do
   * contato, não da conta — trocar de conta dá a mesma recusa, e no próximo
   * ciclo recorrente daria de novo. Então o alvo é pulado em vez de marcado
   * como falha. Todo o resto continua virando falha normal.
   *
   * Devolve true quando engoliu o erro (chamador não deve marcar falha).
   *
   * Quem chama NÃO pula o delay entre envios depois disso: a request recusada
   * pelo Telegram conta no rate limit igual a uma aceita, então drenar alvos
   * mortos em rajada queimaria a conta por flood — o oposto de alcance.
   */
  private async skipIfUnwritable(err: unknown, target: CampaignTargetRow): Promise<boolean> {
    if (!this.deps.skipTarget) return false;
    const reason = classifyUnwritable(err);
    if (!reason) return false;
    await this.deps.skipTarget(target.id, target, reason);
    console.log(
      `[runner] campaign ${this.cfg.campaignId}: alvo ${target.identifier} pulado (${reason})`,
    );
    return true;
  }

  /** Falha comum: marca a linha e, se for sessão morta, derruba a conta. */
  private async failTarget(
    err: unknown,
    target: CampaignTargetRow,
    accountId: string,
  ): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    if (isFatalAccountError(err)) {
      this.pool.markBanned(accountId);
      if (this.deps.markAccountFatal) {
        await this.deps.markAccountFatal(accountId, msg);
      }
    }
    await this.deps.markTargetFailed(target.id, accountId, msg);
  }

  private async processBatch(pending: CampaignTargetRow[]): Promise<void> {
    for (const target of pending) {
      // Verifica se o usuário pausou/deletou pela UI antes de cada envio.
      const liveStatus = await this.deps.getCampaignStatus(this.cfg.campaignId);
      if (liveStatus === null || liveStatus === "paused" || liveStatus === "failed") {
        console.log(`[runner] campaign ${this.cfg.campaignId} stopped mid-loop: status=${liveStatus ?? "deleted"}`);
        return;
      }
      if (this.needsSpacing) {
        const min = this.cfg.delayMinSeconds * 1000;
        const max = this.cfg.delayMaxSeconds * 1000;
        await this.deps.delay(Math.max(0, min + Math.floor(Math.random() * Math.max(1, max - min + 1))));
        const status = await this.deps.getCampaignStatus(this.cfg.campaignId);
        if (status !== "running") return;
      }
      // Se o target tem conta pré-atribuída (campanha global), usa SÓ
      // ela — não cai pra outra conta no fallback porque o access_hash
      // do dialog dela não vale pra outras contas.
      const isPinned = !!target.pinnedAccountId;
      const account = isPinned
        ? this.pool.getById(target.pinnedAccountId!)
        : this.pool.next();
      if (!account) {
        if (this.deps.deferCampaign) {
          await this.defer(this.pool.waitSeconds(target.pinnedAccountId) ?? this.retrySeconds(), "ACCOUNT_UNAVAILABLE", target);
          return;
        }
        if (isPinned) {
          // Conta dona desse target tá indisponível — pula este target e
          // segue a campanha. Outras contas ainda podem processar os
          // próprios targets.
          await this.deps.markTargetFailed(
            target.id,
            target.pinnedAccountId!,
            "pinned_account_unavailable",
          );
          continue;
        }
        await this.deps.setCampaignStatus(this.cfg.campaignId, "paused");
        return;
      }

      if (this.deps.prepareTarget) await this.deps.prepareTarget(target, account.id);
      this.needsSpacing = true;
      let delivered = false;
      try {
        await this.deps.sendMessage(account.id, target, this.cfg.messageText);
        delivered = true;
      } catch (err) {
        const floodSeconds = extractWaitSeconds(err);
        if (this.deps.deferCampaign) {
          const text = err instanceof Error ? err.message : String(err);
          if (floodSeconds !== null) {
            await this.defer(Math.max(1, floodSeconds), `FLOOD_WAIT_${floodSeconds}`, target, account.id);
            return;
          }
          if (/PEER_FLOOD/i.test(text)) {
            // Sem prazo informado pelo Telegram, usa o intervalo escolhido.
            await this.defer(this.retrySeconds(), "PEER_FLOOD", target, account.id);
            return;
          }
          if (transientCampaignError(err)) {
            await this.defer(this.retrySeconds(), "CONNECTION_RETRY", target);
            return;
          }
        }
        if (floodSeconds !== null) {
          this.pool.markFloodWait(account.id, floodSeconds);
          // Em targets pinned não dá pra trocar de conta (access_hash
          // não bate). Em vez de marcar falha permanente (perdendo o lead),
          // marca retry_after pra reprocessar depois do flood (#47).
          if (isPinned) {
            if (this.deps.markTargetRetryAfter) {
              const retryAfter = new Date(Date.now() + Math.max(1, floodSeconds) * 1000).toISOString();
              await this.deps.markTargetRetryAfter(target.id, retryAfter);
            } else {
              await this.deps.markTargetFailed(
                target.id,
                account.id,
                `flood_wait_${floodSeconds}s`,
              );
            }
          } else {
            const nextAccount = this.pool.next();
            if (!nextAccount) {
              await this.deps.setCampaignStatus(this.cfg.campaignId, "paused");
              return;
            }
            try {
              await this.deps.sendMessage(nextAccount.id, target, this.cfg.messageText);
              await this.deps.markTargetSent(target.id, nextAccount.id);
            } catch (err2) {
              if (!(await this.skipIfUnwritable(err2, target))) {
                await this.failTarget(err2, target, nextAccount.id);
              }
            }
          }
        } else if (!(await this.skipIfUnwritable(err, target))) {
          await this.failTarget(err, target, account.id);
        }
      }

      // Falha de persistência não é recusa do Telegram. Deixa o job falhar;
      // a recuperação reusa o random_id e tenta registrar novamente.
      if (delivered) await this.deps.markTargetSent(target.id, account.id);

    }
  }
}
