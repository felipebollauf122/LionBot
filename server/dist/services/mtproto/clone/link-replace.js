import { Api } from "telegram";
import { parseLinkIdentifier } from "../link-parse.js";
import { applyTextReplacements, applyTextUrlReplacements } from "./link-rewrite.js";
function ensureScheme(url) {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
/** Valor de substituição pro texto visível de Mention/Url (sem scheme forçado). */
function textValueFor(kind, values) {
    if (kind === "bot")
        return values.botUsername ? `@${values.botUsername}` : undefined;
    if (kind === "group")
        return values.groupLink;
    if (kind === "channel")
        return values.channelLink;
    return undefined;
}
/** Valor de substituição pro campo .url de TextUrl/botão inline (scheme garantido). */
function urlValueFor(kind, values) {
    if (kind === "bot")
        return values.botUsername ? ensureScheme(`t.me/${values.botUsername}`) : undefined;
    if (kind === "group")
        return values.groupLink ? ensureScheme(values.groupLink) : undefined;
    if (kind === "channel")
        return values.channelLink ? ensureScheme(values.channelLink) : undefined;
    return undefined;
}
/**
 * Reescreve @mentions/links de uma mensagem, trocando toda ocorrência que o
 * Telegram classifica como bot/grupo/canal pelo valor configurado da
 * categoria correspondente. Pessoa comum (user) e tudo que não dá pra
 * classificar (unknown) fica intocado — nunca lança por causa disso.
 *
 * Uma flood de deps.classify PROPAGA (sem try/catch aqui de propósito): o
 * chamador (createPublisher, via CloneRunner.flush) já sabe tratar flood
 * como retomável.
 */
export async function rewriteMessageLinks(input, deps, values) {
    const text = input.message ?? "";
    const { entities, inlineLinks } = input;
    const hasEntities = Boolean(entities && entities.length > 0);
    const hasButtons = Boolean(inlineLinks && inlineLinks.length > 0);
    if (!hasEntities && !hasButtons) {
        return { text, entities, inlineLinks };
    }
    const candidates = [];
    for (const e of entities ?? []) {
        if (e instanceof Api.MessageEntityMention || e instanceof Api.MessageEntityUrl) {
            candidates.push({
                source: "entity",
                entity: e,
                identifier: text.slice(e.offset, e.offset + e.length),
            });
        }
        else if (e instanceof Api.MessageEntityTextUrl) {
            // Classifica pelo destino real (.url), NUNCA pelo texto visível —
            // a label pode ser qualquer coisa ("clique aqui").
            candidates.push({ source: "textUrl", entity: e, identifier: e.url });
        }
    }
    for (const link of inlineLinks ?? []) {
        candidates.push({ source: "button", link, identifier: link.url });
    }
    const parsedCandidates = candidates.map((c) => ({ c, parsed: parseLinkIdentifier(c.identifier) }));
    // Identificadores únicos (por string crua) resolvidos sequencialmente —
    // dedup dentro da mensagem + previsibilidade de flood (não paralelo).
    const uniqueIdentifiers = new Set();
    for (const { c, parsed } of parsedCandidates) {
        if (parsed)
            uniqueIdentifiers.add(c.identifier);
    }
    const classifications = new Map();
    for (const identifier of uniqueIdentifiers) {
        classifications.set(identifier, await deps.classify(identifier));
    }
    const textReplacements = [];
    const textUrlReplacements = [];
    const buttonReplacements = new Map();
    for (const { c, parsed } of parsedCandidates) {
        if (!parsed)
            continue;
        const kind = classifications.get(c.identifier) ?? "unknown";
        if (c.source === "entity") {
            const newText = textValueFor(kind, values);
            if (!newText)
                continue;
            const isMention = newText.startsWith("@");
            textReplacements.push({
                offset: c.entity.offset,
                length: c.entity.length,
                newText,
                // Bot API "mention" exige texto com @; um link não pode ficar
                // marcado como mention, então a entidade muda de tipo — vira um
                // link clicável de verdade em vez de mention quebrado.
                buildEntity: (offset, length) => isMention
                    ? new Api.MessageEntityMention({ offset, length })
                    : new Api.MessageEntityUrl({ offset, length }),
            });
        }
        else if (c.source === "textUrl") {
            const newUrl = urlValueFor(kind, values);
            if (!newUrl)
                continue;
            textUrlReplacements.push({ offset: c.entity.offset, length: c.entity.length, newUrl });
        }
        else {
            const newUrl = urlValueFor(kind, values);
            if (!newUrl)
                continue;
            buttonReplacements.set(c.link, newUrl);
        }
    }
    const rewrittenText = applyTextReplacements(text, entities, textReplacements);
    const finalEntities = applyTextUrlReplacements(rewrittenText.entities, textUrlReplacements);
    const finalInlineLinks = inlineLinks?.map((l) => {
        const newUrl = buttonReplacements.get(l);
        return newUrl ? { ...l, url: newUrl } : l;
    });
    return { text: rewrittenText.text, entities: finalEntities, inlineLinks: finalInlineLinks };
}
