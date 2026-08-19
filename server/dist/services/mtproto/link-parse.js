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
const HOST_PREFIX_RE = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i;
export function parseLinkIdentifier(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    if (trimmed.startsWith("@")) {
        const value = trimmed.slice(1);
        return value && !value.includes("/") ? { kind: "username", value } : null;
    }
    const hostMatch = HOST_PREFIX_RE.exec(trimmed);
    if (!hostMatch)
        return null;
    let rest = trimmed.slice(hostMatch[0].length);
    // Corta query string e fragmento (ex.: t.me/meubot?start=xyz).
    rest = rest.split(/[?#]/, 1)[0];
    // Barra final (ex.: t.me/meucanal/).
    if (rest.endsWith("/"))
        rest = rest.slice(0, -1);
    if (!rest)
        return null;
    if (rest.startsWith("+")) {
        const hash = rest.slice(1);
        return hash && !hash.includes("/") ? { kind: "invite", hash } : null;
    }
    if (rest.toLowerCase().startsWith("joinchat/")) {
        const hash = rest.slice("joinchat/".length);
        return hash && !hash.includes("/") ? { kind: "invite", hash } : null;
    }
    if (rest.startsWith("@")) {
        const value = rest.slice(1);
        return value && !value.includes("/") ? { kind: "username", value } : null;
    }
    // Remanescente com barra: link de preview (t.me/s/canal), deep link
    // interno (t.me/c/123/456) ou mensagem específica (t.me/user/123) — nada
    // disso é um peer resolvível por username, e tentar mesmo assim só
    // gastaria uma RPC fadada a falhar. Rejeita cedo, sem custo de rede.
    return rest.includes("/") ? null : { kind: "username", value: rest };
}
