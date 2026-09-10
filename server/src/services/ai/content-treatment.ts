/**
 * Núcleo do tratamento por IA: monta o prompt e traduz a resposta em patch.
 *
 * Sem rede, sem Supabase: é aqui que moram as regras que NÃO podem depender
 * do humor do modelo (original preservado uma vez, alavanca desligada é
 * decisão e não sugestão, delay truncado na faixa segura).
 */

export const DELAY_MIN_SECONDS = 60;
export const DELAY_MAX_SECONDS = 86400;

export interface DraftMessageForAi {
  id: string;
  position: number;
  text: string | null;
  /** ['photo'], ['video'] … A IA precisa saber que há mídia pra escrever legenda. */
  mediaKinds: string[];
  hasButtons: boolean;
}

export interface AiTreatment {
  id: string;
  action: "keep" | "clean" | "rewrite" | "discard";
  /** null = mantém o texto atual. */
  text: string | null;
  delaySeconds: number;
  reason: string;
}

export interface TreatmentOptions {
  clean: boolean;
  rewrite: boolean;
  smartDelay: boolean;
}

/** Schema do structured output: o modelo devolve exatamente isto. */
const SCHEMA = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          action: { type: "string", enum: ["keep", "clean", "rewrite", "discard"] },
          text: { type: "string", nullable: true },
          delaySeconds: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["id", "action", "delaySeconds", "reason"],
      },
    },
  },
  required: ["itens"],
} as const;

export function buildTreatmentPrompt(
  batch: DraftMessageForAi[],
  contexto: DraftMessageForAi[],
  opts: TreatmentOptions,
): { system: string; user: string; schema: object } {
  const system = [
    "Você prepara postagens raspadas de um canal do Telegram para republicação em outro canal.",
    "",
    "REGRAS QUE NUNCA PODEM SER QUEBRADAS:",
    "- Nunca altere preço, valor, prazo, data, número, percentual ou código de cupom.",
    "- Nunca invente link, @menção ou informação que não esteja no texto original.",
    "- Em qualquer dúvida, devolva action 'keep'. Preservar é sempre a escolha segura.",
    `- delaySeconds sempre entre ${DELAY_MIN_SECONDS} e ${DELAY_MAX_SECONDS}.`,
    "- 'discard' só para anúncio puro de outro canal/bot concorrente, ou mensagem de",
    "  serviço (entrou no grupo, mensagem fixada, mensagem apagada). Sempre com 'reason'",
    "  curto e legível para o dono do canal, em português.",
    "",
    "AÇÕES:",
    opts.clean
      ? "- 'clean': remova @menções e links de canais/bots concorrentes. NÃO mexa em mais nada do texto."
      : "- NÃO use 'clean'.",
    opts.rewrite
      ? "- 'rewrite': parafraseie para evitar plágio e ajuste o tom, preservando fatos, oferta e chamada para ação."
      : "- NÃO use 'rewrite' em hipótese alguma. Se o texto precisar de mudança além da limpeza, devolva 'keep'.",
    opts.smartDelay
      ? "- delaySeconds: escolha o intervalo até esta postagem para a sequência parecer natural para quem acompanha o canal. Teaser puxa o próximo rápido; post de venda respira mais."
      : `- delaySeconds: devolva sempre ${DELAY_MIN_SECONDS * 15}. O intervalo não está sob sua responsabilidade.`,
    "",
    "Devolva um item para CADA mensagem editável, e apenas para elas.",
  ].join("\n");

  const linhas = (m: DraftMessageForAi, editavel: boolean): string =>
    [
      `--- ${editavel ? `id: ${m.id}` : "(contexto)"} | posição ${m.position}`,
      m.mediaKinds.length > 0 ? `mídia: ${m.mediaKinds.join(", ")}` : "mídia: nenhuma",
      m.hasButtons ? "tem botões de link" : "",
      `texto: ${m.text ?? "(sem texto)"}`,
    ]
      .filter(Boolean)
      .join("\n");

  const partes: string[] = [];
  if (contexto.length > 0) {
    partes.push(
      "MENSAGENS ANTERIORES, apenas como contexto de continuidade.",
      "Elas já foram tratadas: NÃO devolva itens para elas.",
      ...contexto.map((m) => linhas(m, false)),
      "",
    );
  }
  partes.push("MENSAGENS A TRATAR:", ...batch.map((m) => linhas(m, true)));

  return { system, user: partes.join("\n"), schema: SCHEMA as unknown as object };
}

/**
 * Traduz um AiTreatment no patch da linha, ou null quando nada muda.
 *
 * Devolver null e não um objeto vazio importa: o caller pula o UPDATE inteiro,
 * o que num lote de 20 em que a IA manteve tudo economiza 20 escritas.
 */
export function applyTreatment(
  row: { content_text: string | null; content_text_original: string | null },
  t: AiTreatment,
  opts: TreatmentOptions,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  // Descarte primeiro: ele não mexe no texto nem no delay (a mensagem não vai
  // entrar na sequência de publicação), e o dono precisa poder ler o que a IA
  // reprovou pra decidir se restaura.
  if (t.action === "discard") {
    // Sem motivo não há descarte: o dono ficaria com uma mensagem riscada e
    // nenhuma explicação. Motivo só de espaços também não conta.
    if (t.reason.trim() === "") return null;
    patch.ai_discarded = true;
    patch.ai_action = "discarded";
    patch.ai_reason = t.reason.trim();
    return patch;
  }

  if (t.action === "clean" || t.action === "rewrite") {
    const novo = (t.text ?? "").trim();
    // text vazio (ou só espaços) com action de mudança é o modelo dizendo
    // "não achei o que mexer". Gravar isso apagaria o post inteiro.
    if (novo !== "") {
      // A alavanca desligada é decisão do dono, não sugestão: um rewrite não
      // autorizado é registrado como cleaned — mas o texto que o modelo
      // mandou ainda é usado, só o rótulo (e a interpretação do que foi
      // feito) muda.
      const autorizadoRewrite = t.action === "rewrite" && opts.rewrite;
      patch.content_text = novo;
      patch.ai_action = autorizadoRewrite ? "rewritten" : "cleaned";
      // Uma vez só: reprocessar não pode apagar o texto raspado.
      if (row.content_text_original === null) {
        patch.content_text_original = row.content_text;
      }
    }
  }

  if (opts.smartDelay) {
    patch.delay_seconds = Math.min(
      DELAY_MAX_SECONDS,
      Math.max(DELAY_MIN_SECONDS, Math.round(t.delaySeconds)),
    );
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
