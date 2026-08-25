import type { FlowEdge, FlowNode, NodeContext, NodeResult } from "../types.js";
import { findNextNodeId, interpolate } from "./text.js";

/** Formato exigido da resposta do lead. "any" aceita qualquer texto. */
export type AnswerValidation = "any" | "email" | "number" | "phone";

const VALIDATORS: Record<Exclude<AnswerValidation, "any">, (v: string) => boolean> = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v),
  number: (v) => /^-?\d+([.,]\d+)?$/.test(v.replace(/\s/g, "")),
  // 10 a 15 dígitos: cobre fixo/celular BR com DDD, com ou sem +55, e
  // internacionais — sem tentar validar operadora, que muda o tempo todo.
  phone: (v) => {
    const digits = v.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
  },
};

const DEFAULT_RETRY: Record<AnswerValidation, string> = {
  any: "❌ Não consegui ler sua resposta. Responde em texto, por favor.",
  email: "❌ <b>E-mail inválido.</b>\n\nManda no formato <code>seunome@gmail.com</code>.",
  number: "❌ <b>Valor inválido.</b>\n\nResponde só com números.",
  phone: "❌ <b>Telefone inválido.</b>\n\nManda com DDD, ex: <code>11 91234-5678</code>.",
};

function validationOf(data: Record<string, unknown>): AnswerValidation {
  const raw = String(data.validation ?? "any");
  return raw === "email" || raw === "number" || raw === "phone" ? raw : "any";
}

export interface InputResponseResult extends NodeResult {
  /** Preenchido quando a resposta não passou na validação: o lead continua
   *  parado no mesmo nó e quem chamou manda esta mensagem antes de esperar de
   *  novo. `nextNodeId` vem como "wait" nesse caso. */
  retryMessage?: string;
}

/**
 * Manda a pergunta e PARA o fluxo ("wait"). A continuação acontece em
 * handleInputResponse, quando o lead responde — quem religa o fluxo é o
 * flow-processor, que guarda a posição do lead neste nó.
 */
export async function handleInputNode(ctx: NodeContext): Promise<NodeResult> {
  const prompt = interpolate(String(ctx.node.data.prompt ?? ""), ctx.lead);

  const sent = await ctx.telegram.sendMessage({
    chatId: ctx.chatId,
    text: prompt,
  });

  return {
    nextNodeId: "wait",
    messageIds: sent ? [sent.message_id] : undefined,
  };
}

/**
 * Resolve a resposta do lead a um nó de pergunta: valida, salva na variável
 * configurada e devolve o próximo nó. Resposta reprovada não avança nem grava
 * — devolve `retryMessage` e mantém o lead esperando no mesmo nó.
 */
export function handleInputResponse(
  node: Pick<FlowNode, "id" | "data">,
  userResponse: string,
  edges: FlowEdge[],
): InputResponseResult {
  const answer = String(userResponse ?? "").trim();
  const validation = validationOf(node.data);

  // Vazio nunca é resposta válida — chega assim quando o lead manda foto,
  // sticker ou áudio no lugar de texto (o webhook normaliza pra "").
  const passed = answer.length > 0 && (validation === "any" || VALIDATORS[validation](answer));

  if (!passed) {
    const custom = String(node.data.retry_message ?? "").trim();
    return {
      nextNodeId: "wait",
      retryMessage: custom || DEFAULT_RETRY[answer.length === 0 ? "any" : validation],
    };
  }

  const variable = String(node.data.variable ?? "").trim();

  return {
    nextNodeId: findNextNodeId(edges, node.id),
    // Sem variável configurada a resposta é só um gate de "continue quando
    // responder" — avança sem sujar o state com uma chave vazia.
    stateUpdates: variable ? { [variable]: answer } : undefined,
  };
}
