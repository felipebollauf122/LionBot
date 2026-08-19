/**
 * Extrai preço de rótulo de botão pra criar produto real na clonagem de bot
 * (não confundir com o guard de payment-guard.ts, que decide se CLICA num
 * botão — esse aqui roda só depois, sobre botões que o guard já pulou).
 */
/** Mesmo universo de botões que transcript-to-flow.ts vira "unmapped" — fonte única, nunca diverge. */
export function isCandidateSkipButton(btn) {
    return btn.kind !== "url" && btn.skip === true;
}
const INSTALLMENT_RE = /(\d+)\s*x\s*(?:de)?\s*(?:r\$|\$)\s*(\d[\d.,]*)/i;
const AMOUNT_RE = /(?:r\$|\$)\s*(\d[\d.,]*)/gi;
export function normalizeLabelForDedupKey(label) {
    return label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
/** Converte "15,93" / "15.93" / "1.234,56" / "1.500" / "1990" pra centavos, ou null se ilegível. */
function parseAmountToCents(numStr) {
    const hasComma = numStr.includes(",");
    const hasDot = numStr.includes(".");
    if (hasComma && hasDot) {
        const decimalSep = numStr.lastIndexOf(",") > numStr.lastIndexOf(".") ? "," : ".";
        const thousandSep = decimalSep === "," ? "." : ",";
        const [intPart, decPart] = numStr.split(decimalSep);
        const cleanInt = intPart.split(thousandSep).join("");
        const cents = Number(cleanInt) * 100 + Number((decPart ?? "0").padEnd(2, "0").slice(0, 2));
        return Number.isFinite(cents) ? cents : null;
    }
    const sep = hasComma ? "," : hasDot ? "." : null;
    if (!sep) {
        const cents = Number(numStr) * 100;
        return Number.isFinite(cents) ? cents : null;
    }
    const parts = numStr.split(sep);
    if (parts.length > 2) {
        // múltiplas ocorrências do mesmo separador só pode ser milhar (decimal aparece uma vez só).
        const cents = Number(parts.join("")) * 100;
        return Number.isFinite(cents) ? cents : null;
    }
    const [intPart, fracPart] = parts;
    if (fracPart.length === 3) {
        // "1.500" -> R$1.500,00 (convenção BR de milhar sem centavos).
        const cents = Number(intPart + fracPart) * 100;
        return Number.isFinite(cents) ? cents : null;
    }
    const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, "0").slice(0, 2));
    return Number.isFinite(cents) ? cents : null;
}
export function parsePriceCentsFromLabel(label) {
    const normalized = label.normalize("NFKC");
    const installmentMatch = normalized.match(INSTALLMENT_RE);
    if (installmentMatch) {
        const installments = Number(installmentMatch[1]);
        const perInstallment = parseAmountToCents(installmentMatch[2]);
        if (Number.isFinite(installments) && installments > 0 && perInstallment !== null) {
            return installments * perInstallment;
        }
    }
    const matches = [...normalized.matchAll(AMOUNT_RE)];
    if (matches.length === 0)
        return null;
    // último preço mencionado no rótulo — cobre "De R$97 por R$47" (o valor cobrado é o final).
    const last = matches[matches.length - 1];
    return parseAmountToCents(last[1]);
}
