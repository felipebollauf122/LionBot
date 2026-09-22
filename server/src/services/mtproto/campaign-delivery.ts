import { createHash } from "node:crypto";

/** Mesmo destino/ciclo usa o mesmo random_id quando a resposta se perde. */
export function campaignMessageId(targetId: string, cycle: string): string {
  return createHash("sha256").update(`campaign:${targetId}:${cycle}`).digest().readBigInt64BE().toString();
}

export async function campaignDeliveryDeadline<T>(operation: () => Promise<T>, abort: () => void, ms = 90_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort();
          reject(new Error("CAMPAIGN_SEND_TIMEOUT"));
        }, ms);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
