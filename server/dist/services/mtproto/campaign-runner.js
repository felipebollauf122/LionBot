function extractFloodWait(err) {
    if (err && typeof err === "object") {
        const e = err;
        const msg = e.message ?? String(err);
        if (/FLOOD/i.test(msg) && typeof e.seconds === "number")
            return e.seconds;
    }
    return null;
}
function isFatalAccountError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return /AUTH_KEY|USER_DEACTIVATED|SESSION_REVOKED|PHONE_NUMBER_BANNED/i.test(msg);
}
export class CampaignRunner {
    pool;
    deps;
    cfg;
    constructor(pool, deps, cfg) {
        this.pool = pool;
        this.deps = deps;
        this.cfg = cfg;
    }
    async run(targets) {
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
            if (this.deps.reloadPool)
                await this.deps.reloadPool();
            const next = await this.deps.refetchPending(this.cfg.campaignId);
            if (next.length === 0) {
                drained = true;
            }
            else {
                console.log(`[runner] campaign ${this.cfg.campaignId}: ${next.length} novos targets pending detectados (provavelmente conta nova conectada), continuando...`);
                currentBatch = next;
            }
        }
        await this.deps.setCampaignStatus(this.cfg.campaignId, "completed");
    }
    async processBatch(pending) {
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
                ? this.pool.getById(target.pinnedAccountId)
                : this.pool.next();
            if (!account) {
                if (isPinned) {
                    // Conta dona desse target tá indisponível — pula este target e
                    // segue a campanha. Outras contas ainda podem processar os
                    // próprios targets.
                    await this.deps.markTargetFailed(target.id, target.pinnedAccountId, "pinned_account_unavailable");
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
            }
            catch (err) {
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
                        }
                        else {
                            await this.deps.markTargetFailed(target.id, account.id, `flood_wait_${floodSeconds}s`);
                            await this.deps.incrementCounters(this.cfg.campaignId, "failed");
                        }
                    }
                    else {
                        const nextAccount = this.pool.next();
                        if (!nextAccount) {
                            await this.deps.setCampaignStatus(this.cfg.campaignId, "paused");
                            return;
                        }
                        try {
                            await this.deps.sendMessage(nextAccount.id, target, this.cfg.messageText);
                            await this.deps.markTargetSent(target.id, nextAccount.id);
                            await this.deps.incrementCounters(this.cfg.campaignId, "sent");
                        }
                        catch (err2) {
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
                }
                else {
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
