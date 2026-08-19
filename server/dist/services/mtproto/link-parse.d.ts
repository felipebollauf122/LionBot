/**
 * Extrai um identificador de peer Telegram (username ou hash de convite) de
 * uma string crua — texto de uma Api.MessageEntityMention/Url, ou a .url de
 * uma Api.MessageEntityTextUrl/botão inline. Puro, sem I/O: quem classifica
 * (bot/grupo/canal/pessoa) é MtprotoClient.classifyLink, não este módulo.
 *
 * Existe porque o parser embutido do gramjs (telegram/Utils.js:100-106,
 * função parseUsername) tem dois defeitos que este módulo corrige:
 *   - não reconhece o formato moderno de convite `t.me/+hash`, só o legado
 *     `t.me/joinchat/hash` (o grupo de captura da regex é `(@|joinchat\/)?`,
 *     sem alternativa pra `+`);
 *   - classifica `t.me/@user` como convite (o mesmo grupo de captura casa o
 *     `@` como se fosse o prefixo `joinchat/`), quando na verdade é um
 *     username público comum.
 */
export type ParsedIdentifier = {
    kind: "username";
    value: string;
} | {
    kind: "invite";
    hash: string;
};
export declare function parseLinkIdentifier(raw: string): ParsedIdentifier | null;
