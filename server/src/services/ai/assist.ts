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
