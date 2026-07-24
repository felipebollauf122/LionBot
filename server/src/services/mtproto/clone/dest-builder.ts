import type { ClonePeer } from "./types.js";

export type DestKind = "broadcast" | "megagroup";

export interface SourceIdentity {
  title: string;
  about: string;
  photo: Buffer | null;
}

export interface DestinationRef {
  channelId: string;
  accessHash: string;
  inviteLink: string | null;
}

export interface DestBuilderDeps {
  readIdentity(source: ClonePeer): Promise<SourceIdentity>;
  createChannel(
    title: string,
    about: string,
    opts: { megagroup: boolean },
  ): Promise<{ channelId: string; accessHash: string }>;
  setAbout(channelId: string, accessHash: string, about: string): Promise<void>;
  setPhoto(channelId: string, accessHash: string, photo: Buffer): Promise<void>;
  promoteBot(channelId: string, accessHash: string, botUsername: string): Promise<void>;
  exportInvite(channelId: string, accessHash: string): Promise<string>;
  persist(jobId: string, dest: DestinationRef): Promise<void>;
}

export interface EnsureDestinationInput {
  jobId: string;
  source: ClonePeer;
  destKind: DestKind;
  destTitle: string;
  copyIdentity: boolean;
  botUsername: string;
  /** Destino já criado numa execução anterior. Quando presente, nada é refeito. */
  existing: DestinationRef | null;
}

/**
 * Canal e supergrupo são ambos peer_type='channel' no Telegram — só o kind do
 * dialog os distingue.
 */
export function deriveDestKind(dialogKind: string): DestKind {
  if (dialogKind === "channel_owner" || dialogKind === "channel_subscriber") {
    return "broadcast";
  }
  if (dialogKind === "group_admin" || dialogKind === "group_member") {
    return "megagroup";
  }
  throw new Error(`DIALOG_KIND_NAO_CLONAVEL: ${dialogKind}`);
}

/**
 * Cria o destino, aplica a identidade da origem, promove o bot a admin e
 * exporta o convite. Idempotente: retomada de job não recria nada.
 *
 * Foto e convite são best-effort. A promoção do bot é fatal — sem bot admin
 * não existe publicação, e falhar aqui é mais barato que falhar na mensagem 1.
 */
export async function ensureDestination(
  deps: DestBuilderDeps,
  input: EnsureDestinationInput,
): Promise<DestinationRef> {
  if (input.existing) return input.existing;

  const identity = input.copyIdentity
    ? await deps.readIdentity(input.source)
    : { title: input.destTitle, about: "", photo: null };

  const about = input.copyIdentity ? identity.about : "";
  const created = await deps.createChannel(input.destTitle, about, {
    megagroup: input.destKind === "megagroup",
  });

  // O canal já existe na conta do usuário a partir daqui — persiste agora,
  // antes do promoteBot (fatal por baixo), pra retomada não criar um segundo
  // canal e queimar mais uma unidade da cota diária de CreateChannel.
  await deps.persist(input.jobId, { ...created, inviteLink: null });

  if (input.copyIdentity) {
    if (about) {
      try {
        await deps.setAbout(created.channelId, created.accessHash, about);
      } catch (err) {
        console.warn("[clone.dest] setAbout falhou (não fatal):", err);
      }
    }
    if (identity.photo) {
      try {
        await deps.setPhoto(created.channelId, created.accessHash, identity.photo);
      } catch (err) {
        console.warn("[clone.dest] setPhoto falhou (não fatal):", err);
      }
    }
  }

  // Fatal de propósito.
  await deps.promoteBot(created.channelId, created.accessHash, input.botUsername);

  let inviteLink: string | null = null;
  try {
    inviteLink = await deps.exportInvite(created.channelId, created.accessHash);
  } catch (err) {
    console.warn("[clone.dest] exportInvite falhou (não fatal):", err);
  }

  const dest: DestinationRef = { ...created, inviteLink };
  if (inviteLink !== null) {
    await deps.persist(input.jobId, dest);
  }
  return dest;
}
