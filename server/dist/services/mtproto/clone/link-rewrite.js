import { Api } from "telegram";
/** Clona uma entidade preservando todos os campos, só troca offset/length. */
function withOffsetLength(entity, offset, length) {
    const clone = Object.create(Object.getPrototypeOf(entity), Object.getOwnPropertyDescriptors(entity));
    clone.offset = offset;
    clone.length = length;
    return clone;
}
/**
 * Substitui trechos de `text` (mentions/urls trocados por outra categoria) e
 * reajusta offset/length de TODA entidade — a substituída e as demais, que
 * podem estar antes, depois, ou sobrepondo o span trocado (ex.: negrito
 * envolvendo uma mention). offset/length são UTF-16 code units (mesma
 * unidade que o resto do pipeline já assume, ver entities.ts) — .slice/
 * .length nativos do JS já operam nessa unidade, sem conversão extra.
 *
 * Zero replacements é o caminho comum (imensa maioria dos clones não liga a
 * troca de link): devolve as MESMAS referências de entrada, sem alocar nada.
 */
export function applyTextReplacements(text, entities, replacements) {
    if (replacements.length === 0)
        return { text, entities };
    // Ordena por offset; descarta defensivamente qualquer substituição que
    // sobreponha a anterior já aceita — Mention/Url/TextUrl nunca deveriam se
    // sobrepor entre si num Api.Message real, mas não confia cegamente nisso.
    const sorted = [...replacements].sort((a, b) => a.offset - b.offset);
    const accepted = [];
    let lastEnd = -Infinity;
    for (const r of sorted) {
        if (r.offset < lastEnd)
            continue;
        accepted.push(r);
        lastEnd = r.offset + r.length;
    }
    // Monta o texto novo num único passe.
    let newText = "";
    let cursor = 0;
    for (const r of accepted) {
        newText += text.slice(cursor, r.offset) + r.newText;
        cursor = r.offset + r.length;
    }
    newText += text.slice(cursor);
    // Mapeia uma posição do texto ORIGINAL pra sua posição no texto NOVO,
    // acumulando o delta de comprimento de toda substituição estritamente
    // antes dela. Uma posição que cai DENTRO do span substituído (só
    // acontece pra boundary de entidade de formatação sobreposta, nunca pro
    // próprio span substituído — esse é tratado à parte por match exato)
    // clampa pro edge mais próximo do span novo, nunca corrompe.
    function mapPos(p) {
        let delta = 0;
        for (const r of accepted) {
            const rEnd = r.offset + r.length;
            if (p <= r.offset)
                break;
            if (p >= rEnd) {
                delta += r.newText.length - r.length;
                continue;
            }
            const distToStart = p - r.offset;
            const distToEnd = rEnd - p;
            return distToStart <= distToEnd ? r.offset + delta : r.offset + delta + r.newText.length;
        }
        return p + delta;
    }
    const outEntities = [];
    for (const e of entities ?? []) {
        const matched = accepted.find((r) => r.offset === e.offset && r.length === e.length);
        if (matched) {
            outEntities.push(matched.buildEntity(mapPos(matched.offset), matched.newText.length));
            continue;
        }
        const newStart = mapPos(e.offset);
        const newEnd = mapPos(e.offset + e.length);
        const newLength = newEnd - newStart;
        // Colapsou a zero (ou negativo) depois do clamp: descarta em vez de
        // mandar uma entidade degenerada pra Bot API — mesma filosofia de
        // entities.ts (descartar defensivamente em vez de enviar lixo).
        if (newLength <= 0)
            continue;
        outEntities.push(withOffsetLength(e, newStart, newLength));
    }
    return { text: newText, entities: outEntities };
}
/**
 * Troca só o .url de Api.MessageEntityTextUrl — o texto visível (label) não
 * muda, então não precisa de nenhuma matemática de offset: é uma troca de
 * campo, não uma edição de string. Zero replacements devolve a MESMA
 * referência do array de entrada.
 */
export function applyTextUrlReplacements(entities, replacements) {
    if (replacements.length === 0 || !entities)
        return entities;
    return entities.map((e) => {
        if (!(e instanceof Api.MessageEntityTextUrl))
            return e;
        const match = replacements.find((r) => r.offset === e.offset && r.length === e.length);
        if (!match)
            return e;
        return new Api.MessageEntityTextUrl({ offset: e.offset, length: e.length, url: match.newUrl });
    });
}
