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
export type CapturedEntityType = "bold" | "italic" | "underline" | "strike" | "spoiler" | "code" | "pre" | "text_link" | "blockquote";
export interface CapturedEntity {
    type: CapturedEntityType;
    offset: number;
    length: number;
    url?: string;
    language?: string;
    collapsed?: boolean;
}
/**
 * Converte entities cruas do gramjs pro shape plano acima. Mesma filosofia
 * de degrade de clone/entities.ts: tipo sem tag reconstruível com segurança
 * (Mention/Url/Hashtag/BotCommand/Email/Phone/Cashtag/MentionName/
 * CustomEmoji/desconhecido) é descartado — o texto por trás sobrevive sem
 * formatação.
 */
export declare function gramjsEntitiesToCaptured(entities: Api.TypeMessageEntity[] | undefined): CapturedEntity[];
export declare function entitiesToHtml(text: string, entities: CapturedEntity[] | undefined): string;
