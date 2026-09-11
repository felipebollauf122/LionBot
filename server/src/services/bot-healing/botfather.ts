import { Api } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { MtprotoClient } from "../mtproto/client.js";
import { extractWaitSeconds } from "../mtproto/flood.js";
import { RecoveryAttention, RetryRecovery, type BotFatherPort } from "./types.js";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class BotFatherConversation implements BotFatherPort {
  private peer!: Api.TypeInputPeer;
  constructor(private client: MtprotoClient, private assertLease: () => Promise<void>) {}

  async open(): Promise<void> {
    await this.client.connect();
    // Let the scheduler handle FLOOD_WAIT instead of sleeping inside GramJS.
    this.client.raw.floodSleepThreshold = 0;
    const entity = await this.client.raw.getEntity("BotFather");
    if (!(entity instanceof Api.User) || !entity.bot || !entity.verified || entity.username?.toLowerCase() !== "botfather") {
      throw new RecoveryAttention("botfather_identity_unverified");
    }
    this.peer = await this.client.raw.getInputEntity(entity);
  }

  async repliesSince(afterId: number): Promise<string[]> {
    await this.assertLease();
    const messages = await this.client.raw.getMessages(this.peer, { minId: afterId, limit: 100 });
    return messages.filter(m => !m.out && m.message).sort((a, b) => a.id - b.id).map(m => m.message);
  }

  private async waitReply(afterId: number): Promise<string> {
    for (let i = 0; i < 30; i++) {
      await sleep(1500);
      const replies = await this.repliesSince(afterId);
      if (replies.length) return replies.join("\n");
    }
    throw new RetryRecovery(60);
  }

  async exchange(text: string, beforeSend?: (afterId: number) => Promise<void>): Promise<string> {
    await sleep(1500);
    await this.assertLease();
    if (beforeSend) {
      const latest = await this.client.raw.getMessages(this.peer, { limit: 1 });
      await beforeSend(latest[0]?.id ?? 0);
    }
    await this.assertLease();
    let sent;
    try {
      sent = await this.client.raw.sendMessage(this.peer, { message: text, parseMode: false });
    } catch (error) {
      const wait = extractWaitSeconds(error);
      if (wait !== null) throw new RetryRecovery(wait, true);
      throw error;
    }
    return this.waitReply(sent.id);
  }

  async photo(bytes: Buffer): Promise<string> {
    await sleep(1500);
    await this.assertLease();
    const sent = await this.client.raw.sendFile(this.peer, { file: new CustomFile("profile.jpg", bytes.length, "", bytes), forceDocument: false });
    return this.waitReply(sent.id);
  }
}
