// Cópia de server/src/services/mtproto/clone/dest-builder.ts (deriveDestKind).
// O projeto duplica helpers puros entre os dois lados — ver target-parser.ts.

export type DestKind = "broadcast" | "megagroup";

const CHANNEL_KINDS = ["channel_owner", "channel_subscriber"];
const GROUP_KINDS = ["group_admin", "group_member"];

export function isClonableKind(dialogKind: string): boolean {
  return CHANNEL_KINDS.includes(dialogKind) || GROUP_KINDS.includes(dialogKind);
}

/**
 * Canal e supergrupo são ambos peer_type='channel' — só o kind os distingue.
 */
export function deriveDestKind(dialogKind: string): DestKind {
  if (CHANNEL_KINDS.includes(dialogKind)) return "broadcast";
  if (GROUP_KINDS.includes(dialogKind)) return "megagroup";
  throw new Error(`DIALOG_KIND_NAO_CLONAVEL: ${dialogKind}`);
}
