import type { AccountPool } from "./pool.js";

export interface CampaignTargetRow {
  id: string;
  identifier: string;
  type: "username" | "phone";
  status: "pending" | "sent" | "failed";
  /**
   * Quando setado, o runner ignora identifier/type e envia direto pro peer
   * via sendMessageToPeer do MtprotoClient (mais barato e seguro — não tenta
   * resolveUsername nem importContacts).
   */
  dialog?: {
    peerId: string;
    peerType: "user" | "chat" | "channel";
    peerAccessHash: string | null;
  };
  /**
   * Quando setado, força essa conta específica a enviar (ignora round-robin
   * do pool). Usado em campanhas globais — cada target já vem com a conta
   * dona do dialog. Se a conta estiver indisponível (flood_wait/banned), o
   * target é pulado naquele tick e retentado depois.
   */
  pinnedAccountId?: string;
}

export interface RunnerDeps {
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
  markTargetRetryAfter?: (targetId: string, retryAfterIso: string) => Promise<void>;
  incrementCounters: (campaignId: string, kind: "sent" | "failed") => Promise<void>;
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
}

interface FloodWaitErrorLike {
  seconds?: number;
  message?: string;
}

function extractFloodWait(err: unknown): number | null {
  if (err && typeof err === "object") {
    const e = err as FloodWaitErrorLike;
    const msg = e.message ?? String(err);
    if (/FLOOD/i.test(msg) && typeof e.seconds === "number") return e.seconds;
  }
  return null;
}

function isFatalAccountError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /AUTH_KEY|USER_DEACTIVATED|SESSION_REVOKED|PHONE_NUMBER_BANNED/i.test(msg);
}

export class CampaignRunner {
  constructor(
    private pool: AccountPool,
    private deps: RunnerDeps,
    private cfg: CampaignConfig,
  ) {}

  async run(targets: CampaignTargetRow[]): Promise<void> {
    await this.deps.setCampaignStatus(this.cfg.campaignId, "running");

    // Loop externo: drena os pending; ao acabar o snapshot, re-consulta o
    // DB pra ver se novos targets foram adicionados (caso típico: conta
    // nova conectada no meio do run de uma campanha global). Sai apenas
    // quando refetch retornar vazio (ou se deps não suportar refetch).
    let currentBatch = targets.filter((t) => t.status === "pending");
    let drained = false;
    while (!drained) {
      await this.processBatch(currentBatch);
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

    await this.deps.setCampaignStatus(this.cfg.campaignId, "completed");
  }

  private async processBatch(pending: CampaignTargetRow[]): Promise<void> {
    for (const target of pending) {
      // Verifica se o usuário pausou/deletou pela UI antes de cada envio.
      const liveStatus = await this.deps.getCampaignStatus(this.cfg.campaignId);
      if (liveStatus === null || liveStatus === "paused" || liveStatus === "failed") {
        console.log(`[runner] campaign ${this.cfg.campaignId} stopped mid-loop: status=${liveStatus ?? "deleted"}`);
        return;
      }
      // Se o target tem conta pré-atribuída (campanha global), usa SÓ
      // ela — não cai pra outra conta no fallback porque o access_hash
      // do dialog dela não vale pra outras contas.
      const isPinned = !!target.pinnedAccountId;
      const account = isPinned
        ? this.pool.getById(target.pinnedAccountId!)
        : this.pool.next();
      if (!account) {
        if (isPinned) {
          // Conta dona desse target tá indisponível — pula este target e
          // segue a campanha. Outras contas ainda podem processar os
          // próprios targets.
          await this.deps.markTargetFailed(
            target.id,
            target.pinnedAccountId!,
            "pinned_account_unavailable",
          );
          await this.deps.incrementCounters(this.cfg.campaignId, "failed");
          continue;
        }
        await this.deps.setCampaignStatus(this.cfg.campaignId, "paused");
        return;
      }

      try {
        await this.deps.sendMessage(account.id, target, this.cfg.messageText);
        await this.deps.markTargetSent(target.id, account.id);
        await this.deps.incrementCounters(this.cfg.campaignId, "sent");
      } catch (err) {
        const floodSeconds = extractFloodWait(err);
        if (floodSeconds !== null) {
          this.pool.markFloodWait(account.id, floodSeconds);
          // Em targets pinned não dá pra trocar de conta (access_hash
          // não bate). Em vez de marcar falha permanente (perdendo o lead),
          // marca retry_after pra reprocessar depois do flood (#47).
          if (isPinned) {
            if (this.deps.markTargetRetryAfter) {
              const retryAfter = new Date(Date.now() + (floodSeconds + 5) * 1000).toISOString();
              await this.deps.markTargetRetryAfter(target.id, retryAfter);
            } else {
              await this.deps.markTargetFailed(
                target.id,
                account.id,
                `flood_wait_${floodSeconds}s`,
              );
              await this.deps.incrementCounters(this.cfg.campaignId, "failed");
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
              await this.deps.incrementCounters(this.cfg.campaignId, "sent");
            } catch (err2) {
              const msg2 = err2 instanceof Error ? err2.message : String(err2);
              if (isFatalAccountError(err2)) {
                this.pool.markBanned(nextAccount.id);
                if (this.deps.markAccountFatal) {
                  await this.deps.markAccountFatal(nextAccount.id, msg2);
                }
              }
              await this.deps.markTargetFailed(target.id, nextAccount.id, msg2);
              await this.deps.incrementCounters(this.cfg.campaignId, "failed");
            }
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          if (isFatalAccountError(err)) {
            this.pool.markBanned(account.id);
            if (this.deps.markAccountFatal) {
              await this.deps.markAccountFatal(account.id, msg);
            }
          }
          await this.deps.markTargetFailed(target.id, account.id, msg);
          await this.deps.incrementCounters(this.cfg.campaignId, "failed");
        }
      }

      const min = this.cfg.delayMinSeconds * 1000;
      const max = this.cfg.delayMaxSeconds * 1000;
      // Delay mínimo de 1s entre envios (#50) — protege contra config 0/0
      // que dispararia mensagens em rajada e queimaria a conta por spam.
      const wait = Math.max(1000, min + Math.floor(Math.random() * Math.max(1, max - min + 1)));
      await this.deps.delay(wait);
    }
  }
}
