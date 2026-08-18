import { Api } from "telegram";

/**
 * Decide se um botão do bot-alvo pode ser clicado automaticamente durante a
 * clonagem de fluxo, ou se precisa ficar de fora (nunca clicado). Arquivo
 * mais crítico de toda a feature — uma classificação errada aqui pode
 * disparar uma compra real. Revisado adversarialmente duas vezes (auto-click
 * e estrutura) antes de qualquer linha de código ser escrita; cada decisão
 * abaixo tem o achado da revisão que a motivou.
 */

export type ButtonKind =
  | "callback"
  | "url"
  | "url_auth"
  | "switch_inline"
  | "game"
  | "buy"
  | "webview"
  | "simple_webview"
  | "reply_keyboard_text"
  | "unknown";

export interface RawButtonInfo {
  kind: ButtonKind;
  label: string;
  url?: string;
  requiresPassword?: boolean;
}

export type ButtonDecision =
  | { action: "click" }
  | { action: "open_url_only"; paymentDomainMatch: boolean }
  | { action: "skip"; reason: string };

/**
 * Converte um botão cru do gramjs pro shape do guard. FALHA FECHADO: todo
 * `Api.TypeKeyboardButton` que o Telegram tem — reconhecido ou não —
 * termina num `kind` explícito. Nenhum `default` trata algo desconhecido
 * como "callback"; um tipo novo do Telegram (ou um que a gente ainda não
 * mapeou) cai em "unknown", que classifyButton sempre pula.
 */
export function mapRawButton(btn: Api.TypeKeyboardButton): RawButtonInfo {
  if (btn instanceof Api.KeyboardButtonCallback) {
    return {
      kind: "callback",
      label: btn.text,
      requiresPassword: Boolean(btn.requiresPassword),
    };
  }
  if (btn instanceof Api.KeyboardButtonUrl) {
    return { kind: "url", label: btn.text, url: btn.url };
  }
  if (btn instanceof Api.KeyboardButtonUrlAuth) {
    return { kind: "url_auth", label: btn.text, url: btn.url };
  }
  if (btn instanceof Api.KeyboardButtonSwitchInline) {
    return { kind: "switch_inline", label: btn.text };
  }
  if (btn instanceof Api.KeyboardButtonGame) {
    return { kind: "game", label: btn.text };
  }
  if (btn instanceof Api.KeyboardButtonBuy) {
    return { kind: "buy", label: btn.text };
  }
  if (btn instanceof Api.KeyboardButtonWebView) {
    return { kind: "webview", label: btn.text, url: btn.url };
  }
  if (btn instanceof Api.KeyboardButtonSimpleWebView) {
    return { kind: "simple_webview", label: btn.text, url: btn.url };
  }
  // KeyboardButton "puro" (teclado de resposta, não inline): "clicar" nele
  // manda o texto do botão como mensagem de texto normal pro bot — uma
  // superfície que esta feature não concede a si mesma (mandaria texto
  // arbitrário pro bot-alvo sem que nenhum guard de botão se aplique).
  if (btn instanceof Api.KeyboardButton) {
    return { kind: "reply_keyboard_text", label: btn.text };
  }
  // Qualquer outro tipo (presente ou futuro) que o Telegram venha a ter.
  return { kind: "unknown", label: "" };
}

// Escapes \u explícitos (nunca caracteres literais no arquivo — invisíveis
// demais pra revisar/editar com segurança): zero-width space/joiners/BOM, e
// o bloco Unicode de marcas diacríticas combinantes (pós-NFD).
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const DIACRITIC_MARK_RE = /[\u0300-\u036f]/g;

/**
 * Blocos Unicode cirilico (U+0400-U+04FF) e grego (U+0370-U+03FF) - os dois
 * scripts mais usados em ataques de homoglifo contra rotulo latino (ex.: a
 * letra cirilica U+0421 e visualmente identica ao "C" latino U+0043). BUG
 * REAL encontrado na revisao final deste arquivo (nao so teorico - verificado
 * rodando classifyButton de verdade com um rotulo real): um rotulo MISTO,
 * so com o primeiro caractere trocado pelo cirilico equivalente e o resto em
 * letra latina normal, batia "click". A checagem de "sem nenhuma letra ASCII"
 * abaixo so pega o caso em que o rotulo INTEIRO foi substituido - uma
 * substituicao parcial preserva letras latinas suficientes pra passar essa
 * checagem, e o caractere cirilico nao bate contra nenhum PAYMENT_KEYWORD_PATTERNS
 * (codigo de caractere diferente do latino correspondente, mesmo com a mesma
 * aparencia visual). NFKC nao resolve isso: unifica formas de compatibilidade
 * DENTRO do mesmo script (fullwidth->ASCII), nunca cruza script (cirilico-
 * >latino) - nao existe tabela de confusaveis (Unicode TR39) neste codigo.
 * Fail-closed: nenhum bot legitimo em PT/EN usa esses scripts num rotulo de
 * botao, entao qualquer ocorrencia (mesmo misturada com letras latinas) ja e
 * motivo de skip.
 */
const CYRILLIC_OR_GREEK_RE = /[\u0400-\u04FF\u0370-\u03FF]/;

/**
 * NFKC (contorna fullwidth/compatibilidade e boa parte de homóglifo) + tira
 * zero-width + minúsculo + tira acento (via NFD + remoção de marca
 * combinante). Usada tanto pro rótulo do botão quanto pro texto da
 * mensagem que o acompanha.
 */
function normalizeLabel(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITIC_MARK_RE, "")
    .trim();
}

const GENERIC_CONFIRM_WORDS = new Set([
  // PT (já sem acento — normalizeLabel já removeu)
  "sim", "ok", "confirmar", "continuar", "prosseguir", "avancar", "proximo",
  "entendi", "beleza", "fechou", "confirmo", "aceito",
  // EN
  "yes", "confirm", "continue", "next", "proceed", "okay", "got", "it",
]);

/**
 * Rótulo curto (≤3 palavras alfabéticas) composto só de afirmação genérica —
 * ex.: "Continuar", "OK", "✅ Confirmar". Achado #1 da revisão adversarial:
 * um botão assim, logo depois de uma tela de preço, pode finalizar uma
 * compra sem nenhuma palavra-chave de pagamento no PRÓPRIO rótulo — prefere
 * bloquear demais a deixar passar.
 */
function isGenericConfirmLabel(normalized: string): boolean {
  const words = normalized.match(/[a-z]+/g) ?? [];
  if (words.length === 0 || words.length > 3) return false;
  return words.every((w) => GENERIC_CONFIRM_WORDS.has(w));
}

export const PAYMENT_KEYWORD_PATTERNS: RegExp[] = [
  // PT
  /\bcomprar\b/, /\bcompra\b/, /\bpagar\b/, /\bpagamento\b/, /\bpague\b/,
  /\bassinar\b/, /\bassinatura\b/, /\badquirir\b/, /\badquira\b/,
  /\bfinalizar\s*compra\b/, /\bconfirmar\s*(compra|pagamento|pedido)\b/,
  /\bgerar\s*(pix|cobranca|boleto)\b/, /\bfechar\s*pedido\b/,
  /\bliberar\s*acesso\b/, /\bdesbloquear\b/, /\brenovar\b/,
  /\bplano\s*(premium|vip|pro)\b/, /\bquero\s*(comprar|assinar)\b/,
  /\bgarantir\b/, /\bvagas?\s*limitada/,
  // EN
  /\bbuy\b/, /\bpurchase\b/, /\bpay\b/, /\bpayment\b/, /\bsubscribe\b/,
  /\bsubscription\b/, /\bcheckout\b/, /\border\s*now\b/, /\bget\s*access\b/,
  /\bunlock\b/, /\bupgrade\b/, /\brenew\b/, /\bconfirm\s*order\b/, /\bplace\s*order\b/,
  // Moeda / parcelamento (independe de idioma)
  /r\$\s?\d/i, /\$\s?\d/, /\d+[.,]\d{2}\s?(reais|usd|brl|dollars?)/i,
  /\d+\s?x\s?de\s?r?\$?\s?\d/i,
];

export const PAYMENT_DOMAIN_PATTERNS: RegExp[] = [
  /(^|\.)zuckpay\.com\.br$/i, /(^|\.)yvepay\.com$/i, /(^|\.)poseidonpay\.site$/i,
  /(^|\.)stripe\.com$/i, /(^|\.)paypal\.com$/i, /(^|\.)mercadopago\.com/i,
  /(^|\.)pagseguro\.uol\.com\.br$/i, /(^|\.)hotmart\.com$/i, /(^|\.)kiwify\.com\.br$/i,
  /(^|\.)eduzz\.com$/i, /(^|\.)monetizze\.com\.br$/i, /(^|\.)braip\.com$/i,
  /(^|\.)kirvano\.com$/i, /(^|\.)ticto\.com\.br$/i, /(^|\.)perfectpay\.com\.br$/i,
  /(^|\.)greenn\.com\.br$/i, /(^|\.)cakto\.com\.br$/i,
  /pay|checkout|billing|invoice|gateway/i,
];

/**
 * Roda DEPOIS de um clique, contra o texto que o bot-alvo respondeu.
 * Rede de segurança final — não engatilha nada sozinha (decisão do usuário:
 * só sinaliza, não pausa a exploração), mas fica registrada por nó pra
 * revisão manual.
 */
export const PAYMENT_CONFIRMATION_PATTERNS: RegExp[] = [
  /\bsucesso\b/, /\baprovado\b/, /\bpagamento\s*confirmado\b/, /\bpedido\s*confirmado\b/,
  /\bpedido\s*#?\d/, /\brecibo\b/, /\bcomprovante\b/, /\bcompra\s*realizada\b/,
  /\bpaid\b/, /\bsuccess\b/, /\bapproved\b/, /\breceipt\b/, /\btransaction\s*id\b/,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

function matchesPaymentDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return matchesAny(PAYMENT_DOMAIN_PATTERNS, host);
  } catch {
    return false;
  }
}

export function scanForPaymentConfirmation(text: string): boolean {
  return matchesAny(PAYMENT_CONFIRMATION_PATTERNS, normalizeLabel(text));
}

/**
 * Classifica um botão. `messageText` é o texto da mensagem que acompanha o
 * botão — preço/contexto de pagamento geralmente está ali, não no rótulo do
 * botão em si (achado #6 da revisão adversarial).
 */
export function classifyButton(btn: RawButtonInfo, messageText: string): ButtonDecision {
  if (btn.kind === "buy") return { action: "skip", reason: "buy_button_native_payment" };
  if (btn.kind === "webview" || btn.kind === "simple_webview") {
    return { action: "skip", reason: "webview_miniapp_checkout" };
  }
  if (btn.kind === "game") return { action: "skip", reason: "game_unsupported" };
  if (btn.kind === "switch_inline") return { action: "skip", reason: "switch_inline_unsupported" };
  if (btn.kind === "url_auth") return { action: "skip", reason: "url_auth_unsupported" };
  if (btn.kind === "reply_keyboard_text") {
    return { action: "skip", reason: "reply_keyboard_text_unsupported" };
  }
  if (btn.kind === "unknown") return { action: "skip", reason: "unknown_button_kind" };
  if (btn.requiresPassword) return { action: "skip", reason: "requires_password_2fa_gated" };

  // Botão de URL nunca dispara RPC — nunca é "click", só sinaliza domínio
  // suspeito pro relatório (o botão em si não corre risco de clique).
  if (btn.kind === "url") {
    return { action: "open_url_only", paymentDomainMatch: btn.url ? matchesPaymentDomain(btn.url) : false };
  }

  // Guarda de exaustividade (achado #4): só "callback" chega até aqui — se
  // ButtonKind ganhar um membro novo no futuro sem essa função ser
  // atualizada, essa checagem barra em vez de deixar passar por engano.
  if (btn.kind !== "callback") {
    return { action: "skip", reason: `unhandled_button_kind:${btn.kind}` };
  }

  // Homóglifo cirílico/grego (misto ou puro) — checado no rótulo CRU, antes
  // de qualquer normalização (NFKC não cruza script, então a ordem aqui não
  // muda o resultado, mas checar cedo evita gastar o resto da função com um
  // rótulo que já é motivo de skip). Ver comentário de CYRILLIC_OR_GREEK_RE.
  if (CYRILLIC_OR_GREEK_RE.test(btn.label)) {
    return { action: "skip", reason: "non_latin_script_label_unverifiable" };
  }

  const normalizedLabel = normalizeLabel(btn.label);

  // Rótulo sem nenhuma letra ASCII/Latina (só emoji/símbolo) — nunca cai no
  // default de clicar (achado #5).
  if (!/[a-z]/.test(normalizedLabel)) {
    return { action: "skip", reason: "non_text_label_unverifiable" };
  }

  if (isGenericConfirmLabel(normalizedLabel)) {
    return { action: "skip", reason: "generic_confirm_requires_review" };
  }

  const normalizedMessage = normalizeLabel(messageText);
  if (matchesAny(PAYMENT_KEYWORD_PATTERNS, normalizedLabel) || matchesAny(PAYMENT_KEYWORD_PATTERNS, normalizedMessage)) {
    return { action: "skip", reason: "payment_keyword_match" };
  }

  return { action: "click" };
}
