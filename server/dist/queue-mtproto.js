import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const mtprotoQueue = new Queue("mtproto", { connection });
export async function enqueueMtproto(data) {
    await mtprotoQueue.add(data.kind, data, {
        attempts: 2,
        backoff: { type: "fixed", delay: 3000 },
        removeOnComplete: 100,
        removeOnFail: 100,
    });
}
