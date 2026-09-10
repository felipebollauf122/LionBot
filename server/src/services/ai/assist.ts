/**
 * Prompts do assistente de IA SOB DEMANDA (Plano 3, Task 4) — os três botões
 * do editor da campanha: reescrever este post, criar legenda pra imagem,
 * resumir. Diferente de content-treatment.ts (tratamento em LOTE, disparado
 * automaticamente ao importar um clone), aqui é uma ação pontual escolhida
 * pelo dono numa mensagem só, chamada via `POST /api/ai/assist`.
 *
 * As guardas duras (preço/prazo/link intactos) são as MESMAS das três ações
 * — sem exceção — porque nenhuma delas tem licença pra inventar ou alterar
 * o que já é fato na postagem.
 */

export type AiAssistAction = "rewrite" | "caption" | "summarize";

const SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
} as const;

/** Guardas compartilhadas: valem para as três ações, sem exceção. */
const GUARDAS = [
  "Nunca altere preço, valor, prazo, data, número, percentual ou código de cupom.",
  "Nunca invente link, @menção ou informação que não esteja no original.",
  "Responda em português, no mesmo registro do texto original.",
].join("\n");

const INSTRUCAO: Record<AiAssistAction, string> = {
  rewrite:
    "Reescreva a postagem abaixo para evitar plágio, preservando fatos, oferta e chamada para ação.",
  caption:
    "Escreva uma legenda curta e persuasiva para a mídia desta postagem, no máximo duas frases.",
  summarize: "Resuma a postagem abaixo em no máximo duas frases, mantendo a chamada para ação.",
};

/**
 * O que a IA deve ouvir sobre a midia de uma linha.
 *
 * `media[].type` e dica de RENDERIZACAO e so admite 'photo'|'video'|'audio' —
 * e o `MediaItem` que a UI le. Documento nao tem representacao nesse union, e
 * o mapeador do rascunho (`toStagedMediaType` em draft-publisher.ts) grava
 * 'photo' como ultimo recurso. Resultado: a IA era informada de que um PDF e
 * uma imagem, e "Criar texto para a imagem" pedia legenda de uma foto que nao
 * existe.
 *
 * Quem diz o que a mensagem E e o `kind` da linha, e ele ja carrega
 * 'document' com fidelidade. Quando ele fala 'document', e ele que vale.
 *
 * A correcao mora aqui, e nao em `toStagedMediaType`, de proposito: aquele
 * union e contrato com a UI (MediaItem), e `normalizeMedia` DESCARTA tipo que
 * nao esteja nele — alarga-lo pra 'document' poria no jsonb um valor que a
 * previa joga fora e o MediaPicker rotula errado, trocando uma mentira por
 * outra. O `kind` da linha sempre foi a fonte honesta.
 */
export function mediaKindsParaIa(
  rowKind: string | null | undefined,
  mediaTypes: string[],
): string[] {
  if (rowKind === "document") return ["document"];
  return mediaTypes;
}

export function buildAssistPrompt(
  action: AiAssistAction,
  texto: string | null,
  mediaKinds: string[],
): { system: string; user: string; schema: object } {
  return {
    system: `${INSTRUCAO[action]}\n\nREGRAS:\n${GUARDAS}`,
    user: [
      mediaKinds.length > 0 ? `mídia: ${mediaKinds.join(", ")}` : "mídia: nenhuma",
      `texto: ${texto ?? "(sem texto)"}`,
    ].join("\n"),
    schema: SCHEMA as unknown as object,
  };
}
