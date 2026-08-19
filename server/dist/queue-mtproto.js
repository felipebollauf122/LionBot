import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const mtprotoQueue = new Queue("mtproto", { connection });
export async function enqueueMtproto(data, opts = {}) {
    await mtprotoQueue.add(data.kind, data, {
        attempts: 2,
        backoff: { type: "fixed", delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 100,
        // Opcional: permite adiar o reenfileiramento (ex.: retomada pós
        // FLOOD_WAIT). Sem isso o resume reenfileiraria na hora e o worker
        // giraria em loop batendo no mesmo bloqueio.
        ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    });
}
