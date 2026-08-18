import { Api } from "telegram";

/**
 * Converte texto+entities capturados de um bot-alvo (via MTProto) pro HTML
 * inline que `TelegramApi.sendMessage`/`sendPhoto`/`sendVideo` já mandam com
 * `parse_mode:"HTML"` fixo (server/src/telegram/api.ts) — não precisa de
 * campo `entities` novo em nenhum nó do engine, só do texto/legenda já vir
 * pronto com as tags.
 *
 * Duas etapas deliberadamente separadas:
 *   1) gramjsEntitiesToCaptured — na CAPTURA (lê o bot-alvo), converte
 *      Api.MessageEntity* pra um shape plano, serializável em JSONB.
 *      Guardar a instância real do gramjs no banco não sobrevive ao
 *      round-trip: volta como objeto plano sem protótipo, e qualquer
 *      `instanceof` (como este arquivo fazia numa versão anterior) falharia
 *      silenciosamente pra TODA entidade depois de um ciclo real de
 *      persistência — por isso o shape plano existe desde a captura, não só
 *      na hora de montar o HTML.
 *   2) entitiesToHtml — na RECONSTRUÇÃO (monta o fluxo), converte esse
 *      shape plano em HTML.
 *
 * Inspirado no unparse recursivo de telegram/extensions/html.js (mesma
 * lógica de aninhamento por slice recursivo), mas não reaproveitado direto:
 * aquela função não escapa o texto puro entre as tags (`&`/`<`/`>` literais
 * no texto do bot-alvo quebrariam o parse HTML do Telegram) e usa `<spoiler>`
 * — tag que o gramjs entende mas a Bot API não.
 */

export type CapturedEntityType =
  | "bold" | "italic" | "underline" | "strike" | "spoiler" | "code" | "pre" | "text_link" | "blockquote";

export interface CapturedEntity {
  type: CapturedEntityType;
  offset: number;
  length: number;
  url?: string; // text_link
  language?: string; // pre
  collapsed?: boolean; // blockquote
}

/**
 * Converte entities cruas do gramjs pro shape plano acima. Mesma filosofia
 * de degrade de clone/entities.ts: tipo sem tag reconstruível com segurança
 * (Mention/Url/Hashtag/BotCommand/Email/Phone/Cashtag/MentionName/
 * CustomEmoji/desconhecido) é descartado — o texto por trás sobrevive sem
 * formatação.
 */
export function gramjsEntitiesToCaptured(entities: Api.TypeMessageEntity[] | undefined): CapturedEntity[] {
  if (!entities) return [];
  const out: CapturedEntity[] = [];
  for (const e of entities) {
    const { offset, length } = e;
    if (e instanceof Api.MessageEntityBold) out.push({ type: "bold", offset, length });
    else if (e instanceof Api.MessageEntityItalic) out.push({ type: "italic", offset, length });
    else if (e instanceof Api.MessageEntityUnderline) out.push({ type: "underline", offset, length });
    else if (e instanceof Api.MessageEntityStrike) out.push({ type: "strike", offset, length });
    else if (e instanceof Api.MessageEntitySpoiler) out.push({ type: "spoiler", offset, length });
    else if (e instanceof Api.MessageEntityCode) out.push({ type: "code", offset, length });
    else if (e instanceof Api.MessageEntityPre) {
      out.push({ type: "pre", offset, length, language: e.language || undefined });
    } else if (e instanceof Api.MessageEntityTextUrl) {
      out.push({ type: "text_link", offset, length, url: e.url });
    } else if (e instanceof Api.MessageEntityBlockquote) {
      out.push({ type: "blockquote", offset, length, collapsed: Boolean(e.collapsed) });
    }
    // demais tipos: sem tag — nada emitido pra essa entidade, o texto por
    // trás sobrevive puro no output final.
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function wrapEntity(entity: CapturedEntity, inner: string): string {
  switch (entity.type) {
    case "bold":
      return `<b>${inner}</b>`;
    case "italic":
      return `<i>${inner}</i>`;
    case "underline":
      return `<u>${inner}</u>`;
    case "strike":
      return `<s>${inner}</s>`;
    case "spoiler":
      return `<span class="tg-spoiler">${inner}</span>`;
    case "code":
      return `<code>${inner}</code>`;
    case "pre":
      return entity.language
        ? `<pre><code class="language-${escapeAttr(entity.language)}">${inner}</code></pre>`
        : `<pre>${inner}</pre>`;
    case "text_link":
      return `<a href="${escapeAttr(entity.url ?? "")}">${inner}</a>`;
    case "blockquote":
      return entity.collapsed ? `<blockquote expandable>${inner}</blockquote>` : `<blockquote>${inner}</blockquote>`;
  }
}

/** offset/length em UTF-16 code units, relativos ao texto ORIGINAL — mesma convenção de entities.ts. */
function unparseSegment(
  text: string,
  entities: CapturedEntity[],
  segmentOffset: number,
  segmentLength: number,
): string {
  if (entities.length === 0) return escapeHtml(text);

  const out: string[] = [];
  let lastOffset = 0; // relativo a este segmento
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity.offset >= segmentOffset + segmentLength) break;
    const relativeOffset = entity.offset - segmentOffset;
    if (relativeOffset > lastOffset) {
      out.push(escapeHtml(text.slice(lastOffset, relativeOffset)));
    } else if (relativeOffset < lastOffset) {
      continue; // sobreposto por uma entidade já emitida — defensivo, não deveria ocorrer em mensagem real
    }

    const length = entity.length;
    const innerText = text.slice(relativeOffset, relativeOffset + length);
    const innerHtml = unparseSegment(innerText, entities.slice(i + 1), entity.offset, length);
    out.push(wrapEntity(entity, innerHtml));
    lastOffset = relativeOffset + length;
  }
  if (lastOffset < text.length) out.push(escapeHtml(text.slice(lastOffset)));
  return out.join("");
}

export function entitiesToHtml(text: string, entities: CapturedEntity[] | undefined): string {
  if (!entities || entities.length === 0) return escapeHtml(text);
  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  return unparseSegment(text, sorted, 0, text.length);
}
