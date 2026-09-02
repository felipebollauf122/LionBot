import type { FeedMessage, GroupedMessage } from "@/lib/social-proof/types";
import { offsetToDate } from "@/lib/social-proof/format";

/**
 * Distância máxima entre duas mensagens do mesmo remetente pra continuarem no
 * mesmo grupo. Acima disso o Telegram separa, com nome e avatar repetidos.
 */
export const GROUP_GAP_SECONDS = 900;

function sameSender(a: FeedMessage, b: FeedMessage): boolean {
  // Remetentes de espécies diferentes nunca agrupam, mesmo com nome igual: a
  // tela os mostra como pessoas distintas (a dona ganha selo e o avatar do
  // canal), e um avatar só cobrindo os dois seria mentira visual.
  if (a.senderKind !== b.senderKind) return false;

  // Mensagens da dona tiram identidade do CANAL — o senderName da mensagem é
  // ignorado na renderização, então não pode separar grupos aqui.
  if (a.senderKind === "owner") return true;

  return a.senderName.trim() === b.senderName.trim();
}

function closeEnough(a: FeedMessage, b: FeedMessage): boolean {
  return Math.abs(a.offsetSeconds - b.offsetSeconds) <= GROUP_GAP_SECONDS;
}

/**
 * Marca cada mensagem com sua posição no grupo.
 *
 * No Telegram, mensagens consecutivas do mesmo remetente viram um bloco:
 * o nome aparece só na primeira, o avatar e o rabinho da bolha só na última.
 * Clone que repete avatar em toda mensagem é o erro que mais denuncia.
 *
 * A entrada já vem ordenada por `position` (mais antiga primeiro).
 */
export function groupMessages(messages: FeedMessage[], now: Date): GroupedMessage[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];

    const continuaAnterior = prev !== undefined && sameSender(prev, m) && closeEnough(prev, m);
    const continuaProxima = next !== undefined && sameSender(m, next) && closeEnough(m, next);

    return {
      ...m,
      isFirstOfGroup: !continuaAnterior,
      isLastOfGroup: !continuaProxima,
      at: offsetToDate(m.offsetSeconds, now),
    };
  });
}
