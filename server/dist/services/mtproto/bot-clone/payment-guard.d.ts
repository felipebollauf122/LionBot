import { Api } from "telegram";
/**
 * Decide se um botão do bot-alvo pode ser clicado automaticamente durante a
 * clonagem de fluxo, ou se precisa ficar de fora (nunca clicado). Arquivo
 * mais crítico de toda a feature — uma classificação errada aqui pode
 * disparar uma compra real. Revisado adversarialmente duas vezes (auto-click
 * e estrutura) antes de qualquer linha de código ser escrita; cada decisão
 * abaixo tem o achado da revisão que a motivou.
 */
export type ButtonKind = "callback" | "url" | "url_auth" | "switch_inline" | "game" | "buy" | "webview" | "simple_webview" | "reply_keyboard_text" | "unknown";
export interface RawButtonInfo {
    kind: ButtonKind;
    label: string;
    url?: string;
    requiresPassword?: boolean;
}
export type ButtonDecision = {
    action: "click";
} | {
    action: "open_url_only";
    paymentDomainMatch: boolean;
} | {
    action: "skip";
    reason: string;
};
/**
 * Converte um botão cru do gramjs pro shape do guard. FALHA FECHADO: todo
 * `Api.TypeKeyboardButton` que o Telegram tem — reconhecido ou não —
 * termina num `kind` explícito. Nenhum `default` trata algo desconhecido
 * como "callback"; um tipo novo do Telegram (ou um que a gente ainda não
 * mapeou) cai em "unknown", que classifyButton sempre pula.
 */
export declare function mapRawButton(btn: Api.TypeKeyboardButton): RawButtonInfo;
export declare const PAYMENT_KEYWORD_PATTERNS: RegExp[];
export declare const PAYMENT_DOMAIN_PATTERNS: RegExp[];
/**
 * Roda DEPOIS de um clique, contra o texto que o bot-alvo respondeu.
 * Rede de segurança final — não engatilha nada sozinha (decisão do usuário:
 * só sinaliza, não pausa a exploração), mas fica registrada por nó pra
 * revisão manual.
 */
export declare const PAYMENT_CONFIRMATION_PATTERNS: RegExp[];
export declare function scanForPaymentConfirmation(text: string): boolean;
/**
 * Classifica um botão. `messageText` é o texto da mensagem que acompanha o
 * botão — preço/contexto de pagamento geralmente está ali, não no rótulo do
 * botão em si (achado #6 da revisão adversarial).
 */
export declare function classifyButton(btn: RawButtonInfo, messageText: string): ButtonDecision;
