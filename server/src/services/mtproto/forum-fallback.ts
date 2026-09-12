import { classifyUnwritable } from "./unwritable.js";

/**
 * Grupo em modo fórum: a mensagem sem `topMsgId` vai pro tópico General
 * (id 1). Muitos fóruns fecham o General e deixam só tópicos específicos
 * abertos — aí o Telegram responde TOPIC_CLOSED e o alvo virava falha, embora
 * o grupo aceite a mensagem em outro tópico. Este módulo faz o desvio: no
 * TOPIC_CLOSED lista os tópicos, escolhe um aberto, reenvia ancorado nele e
 * guarda o escolhido (mtproto_dialogs.forum_topic_id) pra próxima vez ir
 * direto. Sem tópico aberto, relança o TOPIC_CLOSED — o runner então pula o
 * alvo como recusa permanente.
 *
 * Só TOPIC_CLOSED entra no desvio: qualquer outro erro passa reto, sem gastar
 * um channels.GetForumTopics à toa.
 */

export interface ForumTopicLike {
  id: number;
  closed?: boolean;
  hidden?: boolean;
  title?: string;
}

const GENERAL_TOPIC_ID = 1;

/**
 * Prefere o General quando aberto (é onde a mensagem cairia sem desvio);
 * senão o primeiro tópico aberto e visível na ordem devolvida pelo Telegram
 * (mais recente primeiro). null = nenhum aberto.
 */
export function pickOpenTopic(topics: ForumTopicLike[]): number | null {
  const open = topics.filter((t) => !t.closed && !t.hidden);
  if (open.some((t) => t.id === GENERAL_TOPIC_ID)) return GENERAL_TOPIC_ID;
  return open[0]?.id ?? null;
}

export interface ForumFallbackDeps {
  /** Tópico já escolhido num envio anterior (mtproto_dialogs.forum_topic_id). */
  knownTopicId: number | null;
  /** Envia ancorado no tópico; `undefined` = General. */
  send: (topMsgId?: number) => Promise<void>;
  listTopics: () => Promise<ForumTopicLike[]>;
  rememberTopic: (topicId: number) => Promise<void>;
}

export async function sendWithForumFallback(deps: ForumFallbackDeps): Promise<void> {
  const first = deps.knownTopicId ?? undefined;
  try {
    await deps.send(first);
    return;
  } catch (err) {
    if (classifyUnwritable(err) !== "TOPIC_CLOSED") throw err;
    // O tópico que acabou de recusar sai da escolha mesmo que a listagem
    // ainda o mostre aberto (cache do Telegram): reenviar nele só repetiria
    // o TOPIC_CLOSED.
    const refused = first ?? GENERAL_TOPIC_ID;
    const topics = await deps.listTopics();
    const topicId = pickOpenTopic(topics.filter((t) => t.id !== refused));
    if (topicId === null) throw err;
    await deps.send(topicId);
    await deps.rememberTopic(topicId);
  }
}
