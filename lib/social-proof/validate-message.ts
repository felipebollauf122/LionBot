import type { MessageInput } from "@/lib/social-proof/types";

export type ValidationResult = { ok: true } | { ok: false; error: string };

const MAX_TEXTO = 1024;
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

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

  if (!temTexto && !temMidia) {
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

  if (input.kind !== "text" && input.kind !== "album") {
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
