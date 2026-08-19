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
    createChannel(title: string, about: string, opts: {
        megagroup: boolean;
        forum: boolean;
    }): Promise<{
        channelId: string;
        accessHash: string;
    }>;
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
    /** Origem é fórum (Topics ligado) e o destino deve nascer fórum também. */
    forum: boolean;
    /**
     * Destino já criado numa execução anterior. Quando presente, canal e
     * identidade não são refeitos — mas a promoção do bot SEMPRE roda de novo
     * (defeito I4, ver ensureDestination).
     */
    existing: DestinationRef | null;
}
/**
 * Canal e supergrupo são ambos peer_type='channel' no Telegram — só o kind do
 * dialog os distingue.
 */
export declare function deriveDestKind(dialogKind: string): DestKind;
/**
 * Cria o destino, aplica a identidade da origem, promove o bot a admin e
 * exporta o convite. Retomada de job não recria canal nem identidade — mas
 * SEMPRE repromove o bot.
 *
 * Foto e convite são best-effort. A promoção do bot é fatal — sem bot admin
 * não existe publicação, e falhar aqui é mais barato que falhar na mensagem 1.
 */
export declare function ensureDestination(deps: DestBuilderDeps, input: EnsureDestinationInput): Promise<DestinationRef>;
