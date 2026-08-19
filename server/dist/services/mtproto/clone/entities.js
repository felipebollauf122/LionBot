import { Api } from "telegram";
/**
 * Converte entidades gramjs (Api.MessageEntity*) pro shape que a Bot API
 * espera (grammy `entities`/`caption_entities`).
 *
 * DEFEITO C1: gramjs serializa cada entidade como `{...args, className}` —
 * SEM o campo `type` que a Bot API exige. Passar `raw.entities` direto pro
 * grammy rende 400 "can't parse entities" e o clone-runner marca o grupo
 * inteiro como failed (toda formatação — negrito, links — da rota download
 * se perde). Esta função é pura e sem I/O de propósito: é o ponto crítico
 * do defeito, então precisa ser testável isoladamente.
 *
 * offset/length são copiados verbatim: gramjs e a Bot API usam as duas a
 * mesma unidade (UTF-16 code units), não há recomputação a fazer.
 */
export function toBotApiEntities(entities) {
    if (!entities)
        return [];
    const out = [];
    for (const entity of entities) {
        const mapped = toBotApiEntity(entity);
        if (mapped)
            out.push(mapped);
    }
    return out;
}
function toBotApiEntity(e) {
    const { offset, length } = e;
    if (e instanceof Api.MessageEntityBold)
        return { type: "bold", offset, length };
    if (e instanceof Api.MessageEntityItalic)
        return { type: "italic", offset, length };
    if (e instanceof Api.MessageEntityUnderline)
        return { type: "underline", offset, length };
    if (e instanceof Api.MessageEntityStrike)
        return { type: "strikethrough", offset, length };
    if (e instanceof Api.MessageEntitySpoiler)
        return { type: "spoiler", offset, length };
    if (e instanceof Api.MessageEntityCode)
        return { type: "code", offset, length };
    if (e instanceof Api.MessageEntityUrl)
        return { type: "url", offset, length };
    if (e instanceof Api.MessageEntityMention)
        return { type: "mention", offset, length };
    if (e instanceof Api.MessageEntityHashtag)
        return { type: "hashtag", offset, length };
    if (e instanceof Api.MessageEntityCashtag)
        return { type: "cashtag", offset, length };
    if (e instanceof Api.MessageEntityBotCommand)
        return { type: "bot_command", offset, length };
    if (e instanceof Api.MessageEntityEmail)
        return { type: "email", offset, length };
    if (e instanceof Api.MessageEntityPhone)
        return { type: "phone_number", offset, length };
    if (e instanceof Api.MessageEntityPre) {
        return { type: "pre", offset, length, language: e.language };
    }
    if (e instanceof Api.MessageEntityTextUrl) {
        return { type: "text_link", offset, length, url: e.url };
    }
    if (e instanceof Api.MessageEntityBlockquote) {
        // A Bot API não tem um campo "collapsed" separado: o colapso é o
        // próprio tipo da entidade (blockquote vs expandable_blockquote).
        return e.collapsed
            ? { type: "expandable_blockquote", offset, length }
            : { type: "blockquote", offset, length };
    }
    // MessageEntityMentionName: text_mention exige um objeto User completo da
    // Bot API que não temos aqui (só o userId do MTProto) — descarta a
    // entidade; o texto puro por trás (@alguém) sobrevive, degrade correto.
    if (e instanceof Api.MessageEntityMentionName)
        return null;
    // MessageEntityCustomEmoji: um bot sem Premium não consegue mandar
    // custom_emoji — descarta; o texto/emoji unicode por trás sobrevive.
    if (e instanceof Api.MessageEntityCustomEmoji)
        return null;
    // Classe desconhecida (ou futura, ainda não mapeada aqui): descarta
    // defensivamente em vez de mandar algo que a Bot API vai rejeitar.
    return null;
}
