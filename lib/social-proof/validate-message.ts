import type { MessageInput } from "@/lib/social-proof/types";

export type ValidationResult = { ok: true } | { ok: false; error: string };

const MAX_TEXTO = 1024;
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Tipos que só `mtproto_scheduled_messages` produz: o clone os traz e o bot
 * sabe publicá-los, mas o editor não os monta — ele edita a legenda, e o
 * anexo continua sendo o que veio do canal de origem.
 *
 * Ficam de fora das regras de "a mídia bate com o tipo escolhido" porque não
 * há tipo a escolher: a `media[]` de um documento carrega `type: "photo"`
 * (StagedMedia herda o union de MediaItem, que não tem "document") e uma
 * enquete não tem mídia nenhuma — o conteúdo dela vive na coluna `poll`.
 * Sem esta abertura, quem clona um canal de PDFs não consegue salvar sequer
 * uma correção de legenda.
 *
 * A Prova Social nunca chega aqui com esses dois: nem o union de `kind` dela
 * nem o editor os produzem.
 */
const KINDS_SEM_EDITOR = new Set(["document", "poll"]);

/**
 * Valida uma mensagem antes de gravar.
 *
 * As mensagens são as que o composer mostra ao tenant, então estão em
 * português e descrevem a correção, não o sintoma. Esta função é a fonte
 * única delas: a Server Action a chama e devolve o texto como está.
 */
export function validateMessage(input: MessageInput): ValidationResult {
  const temTexto = (input.content_text ?? "").trim() !== "";
  const temMidia = input.media.length > 0;
  // `as string`: MessageKind não tem esses dois — eles entram pela linha da
  // campanha, que paraInput força pra dentro do union.
  const semEditor = KINDS_SEM_EDITOR.has(input.kind as string);

  // Enquete sem legenda não está vazia: a pergunta e as opções estão na coluna
  // `poll`, que este validador não recebe e o editor não mexe.
  if (!temTexto && !temMidia && !semEditor) {
    return { ok: false, error: "A mensagem precisa de texto ou mídia." };
  }

  if ((input.content_text ?? "").length > MAX_TEXTO) {
    return { ok: false, error: "O texto passa de 1024 caracteres." };
  }

  // A dona tira a identidade do canal; só membro precisa de nome próprio.
  if (input.sender_kind === "member" && input.sender_name.trim() === "") {
    return { ok: false, error: "O nome do remetente não pode ficar vazio." };
  }

  if (input.offset_seconds < 0) {
    return { ok: false, error: "O tempo atrás não pode ser negativo." };
  }

  if (input.views_count < 0) {
    return { ok: false, error: "As visualizações não podem ser negativas." };
  }

  if (input.kind === "album" && input.media.length < 2) {
    return { ok: false, error: "Um álbum precisa de pelo menos duas mídias." };
  }

  if (!semEditor && input.kind !== "text" && input.kind !== "album") {
    if (!temMidia) {
      return { ok: false, error: "Escolha um arquivo ou cole uma URL." };
    }
    if (input.media[0].type !== input.kind) {
      return { ok: false, error: "A mídia enviada não é do tipo escolhido." };
    }
  }

  if (input.display_time !== null && !HORARIO.test(input.display_time)) {
    return { ok: false, error: "O horário precisa estar no formato HH:MM." };
  }

  return { ok: true };
}
