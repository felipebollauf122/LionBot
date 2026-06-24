import { TelegramApi } from "../telegram/api.js";
type LoginSlot = "welcome" | "code_prompt" | "password_prompt" | "success" | "error";
interface RenderedItem {
    kind: "text" | "image" | "video" | "delay";
    text?: string;
    url?: string;
    caption?: string;
    delaySeconds?: number;
}
export declare function invalidateLoginFlowCache(botId: string): void;
/**
 * Resolve um slot retornando uma sequência de itens renderizáveis (texto,
 * imagem, vídeo, delay) na ordem em que devem ser enviados ao usuário.
 *
 * Algoritmo: pega todos os nós com data.login_slot=slot, ordena por
 * position.y (cliente posiciona verticalmente quem vem antes). Se não houver
 * nenhum nó, retorna null pra que o handler use fallback hardcoded.
 */
export declare function getLoginSlot(botId: string, slot: LoginSlot, vars?: Record<string, string>): Promise<RenderedItem[] | null>;
/**
 * Envia os items renderizados pro chat. Retorna o id da última mensagem
 * enviada (útil pro caller saber qual editar depois — ex: numpad).
 */
export declare function sendRenderedSequence(telegram: TelegramApi, chatId: number, items: RenderedItem[]): Promise<number | null>;
/**
 * Pega só o texto primário do slot (último nó text ou primeiro com text).
 * Útil pro numpad onde a mensagem precisa ser editada in-place — só funciona
 * com texto puro.
 */
export declare function getLoginSlotText(botId: string, slot: LoginSlot, vars: Record<string, string> | undefined, fallback: string): Promise<string>;
export {};
