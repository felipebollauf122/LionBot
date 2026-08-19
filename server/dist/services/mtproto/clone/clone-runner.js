import { extractWaitSeconds } from "../flood.js";
/** Máximo de itens por álbum aceito pelo Telegram. */
const ALBUM_MAX = 10;
export class CloneRunner {
    deps;
    cfg;
    idMap = new Map();
    copied = 0;
    skipped = 0;
    failed = 0;
    seen = 0;
    constructor(deps, cfg) {
        this.deps = deps;
        this.cfg = cfg;
    }
    async run() {
        for (const [src, dest] of await this.deps.loadIdMap(this.cfg.jobId)) {
            this.idMap.set(src, dest);
        }
        // Semeia os contadores do que já foi persistido: o runner é recriado do
        // zero a cada retomada (ex.: depois de um FLOOD_WAIT), então sem isso o
        // progresso reportado volta pra trás e o messageLimit recomeça a contar.
        const counters = await this.deps.loadCounters(this.cfg.jobId);
        this.copied = counters.copied;
        this.skipped = counters.skipped;
        this.failed = counters.failed;
        this.seen = counters.seen;
        const cursor = this.highestCopiedSource();
        await this.deps.setStatus(this.cfg.jobId, "running", {});
        let pendingGroup = [];
        let pendingGroupId = null;
        try {
            for await (const msg of this.deps.iterate(cursor)) {
                if (await this.shouldStop())
                    return;
                if (this.limitReached())
                    break;
                // Álbum só fecha quando muda o groupedId (ou quando enche).
                if (msg.groupedId && msg.groupedId === pendingGroupId) {
                    pendingGroup.push(msg);
                    if (pendingGroup.length === ALBUM_MAX) {
                        await this.flush(pendingGroup);
                        pendingGroup = [];
                        pendingGroupId = null;
                    }
                    continue;
                }
                if (pendingGroup.length > 0) {
                    await this.flush(pendingGroup);
                    if (await this.shouldStop())
                        return;
                    if (this.limitReached())
                        break;
                }
                pendingGroup = [msg];
                pendingGroupId = msg.groupedId;
                if (!msg.groupedId) {
                    await this.flush(pendingGroup);
                    pendingGroup = [];
                    pendingGroupId = null;
                }
            }
            if (pendingGroup.length > 0 && !this.limitReached()) {
                await this.flush(pendingGroup);
            }
        }
        catch (err) {
            const wait = extractWaitSeconds(err);
            if (wait !== null) {
                // O cursor já está persistido: retomar é só rechamar o job.
                await this.deps.setStatus(this.cfg.jobId, "waiting_flood", {
                    ...this.counters(),
                    lastError: `flood_wait_${wait}s`,
                });
                await this.deps.scheduleResume(this.cfg.jobId, wait);
                return;
            }
            await this.deps.setStatus(this.cfg.jobId, "failed", {
                ...this.counters(),
                lastError: err instanceof Error ? err.message : String(err),
            });
            return;
        }
        // Pins só depois de todo o envio: os ids de destino dos pins não
        // existem até a mensagem correspondente já ter sido clonada.
        if (this.cfg.copyPins)
            await this.applyPins();
        await this.deps.setStatus(this.cfg.jobId, "completed", this.counters());
    }
    /** Publica um grupo, grava o resultado e avança o cursor. */
    async flush(group) {
        const replyToDestId = this.resolveReply(group[0]);
        const cursor = group[group.length - 1].id;
        let outcomes;
        try {
            outcomes = await this.deps.publish(group, replyToDestId);
        }
        catch (err) {
            if (extractWaitSeconds(err) !== null)
                throw err; // flood sobe pro run()
            const reason = err instanceof Error ? err.message : String(err);
            outcomes = group.map(() => ({ status: "failed", reason }));
        }
        const rows = group.map((msg, i) => {
            const outcome = outcomes[i] ?? { status: "failed", reason: "sem_resultado" };
            this.seen++;
            if (outcome.status === "copied") {
                this.copied++;
                this.idMap.set(msg.id, outcome.destMsgId);
                return {
                    sourceMsgId: msg.id,
                    destMsgId: outcome.destMsgId,
                    groupedId: msg.groupedId,
                    status: "copied",
                    reason: null,
                };
            }
            if (outcome.status === "skipped")
                this.skipped++;
            else
                this.failed++;
            return {
                sourceMsgId: msg.id,
                destMsgId: null,
                groupedId: msg.groupedId,
                status: outcome.status,
                reason: outcome.reason,
            };
        });
        await this.deps.persist(this.cfg.jobId, rows, cursor);
        // Heartbeat de progresso (defeito I3) — depois do persist, pra refletir
        // os contadores já atualizados por este flush.
        await this.deps.heartbeat(this.cfg.jobId, this.counters());
        if (this.cfg.throttleMs > 0)
            await this.deps.delay(this.cfg.throttleMs);
    }
    /**
     * Resposta só é remapeada se o alvo já foi clonado. Alvo fora do
     * messageLimit vira envio sem resposta — perder o encadeamento é melhor
     * que perder a mensagem.
     */
    resolveReply(first) {
        if (!this.cfg.copyReplies || first.replyToMsgId === null)
            return null;
        return this.idMap.get(first.replyToMsgId) ?? null;
    }
    async applyPins() {
        const sourceIds = await this.deps.sourcePinnedIds();
        const destIds = sourceIds
            .map((id) => this.idMap.get(id))
            .filter((id) => typeof id === "number");
        if (destIds.length > 0)
            await this.deps.pinInDest(destIds);
    }
    async shouldStop() {
        const status = await this.deps.getStatus(this.cfg.jobId);
        return status === null || status === "paused" || status === "failed";
    }
    limitReached() {
        return this.cfg.messageLimit !== null && this.seen >= this.cfg.messageLimit;
    }
    highestCopiedSource() {
        let max = 0;
        for (const src of this.idMap.keys())
            if (src > max)
                max = src;
        return max;
    }
    counters() {
        return {
            copiedCount: this.copied,
            skippedCount: this.skipped,
            failedCount: this.failed,
            totalSeen: this.seen,
        };
    }
}
