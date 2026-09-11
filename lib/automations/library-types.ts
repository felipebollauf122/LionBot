export const libraryKinds = ["text", "photo", "video", "audio", "album", "document", "poll"] as const;
export type LibraryKind = typeof libraryKinds[number];
export interface LibraryButton { text: string; url: string }
export interface LibraryRules {
  ai_enabled: boolean;
  ai_instructions: string;
  delivery_mode: "review" | "immediate" | "interval";
  interval_seconds: number;
  start_at: string | null;
  timezone: string;
  silent: boolean;
  media_mode: "album" | "separate";
  button_message: string;
  preserve_buttons: boolean;
  buttons: LibraryButton[];
  replacements: Array<{ from: string; to: string }>;
  prefix: string;
  suffix: string;
  allowed_kinds: string[];
}
export const defaultLibraryRules: LibraryRules = {
  ai_enabled: false, ai_instructions: "", delivery_mode: "review",
  interval_seconds: 900, start_at: null, timezone: "America/Sao_Paulo",
  silent: true, media_mode: "album", button_message: "Acesse os links", preserve_buttons: true, buttons: [], replacements: [],
  prefix: "", suffix: "", allowed_kinds: [...libraryKinds],
};
export interface LibraryContent {
  kind: string;
  content_text: string | null;
  media: Array<{ url: string; kind?: string; type?: string; file_name?: string }>;
  entities?: unknown[] | null;
  inline_links?: Array<{ text: string; url: string }> | null;
  buttons?: LibraryButton[];
  discard?: boolean;
  media_mode?: "album" | "separate";
  button_message?: string;
  member_ids?: string[];
  poll?: { question: string; options: string[]; [key: string]: unknown } | null;
  file_name?: string | null;
}
export interface AutomationLibrary {
  id: string; tenant_id: string; name: string; dest_dialog_id: string | null;
  rules: LibraryRules; enabled: boolean; last_error: string | null;
  created_at: string; updated_at: string;
}
export interface LibrarySource {
  id: string; library_id: string; source_dialog_id: string | null;
  import_history: boolean; watch: boolean; status: string;
  cursor_message_id: number; imported_count: number; last_error: string | null;
}
export interface LibraryItem {
  id: string; library_id: string; source_id: string; source_message_id: number;
  original: LibraryContent; processed: LibraryContent | null;
  status: string; delivery_status: string; scheduled_at: string | null;
  sent_at: string | null; last_error: string | null; created_at: string;
  delivery_claimed_at: string | null;
  delivery_receipts: Array<{step: string; messageIds: number[]}>;
}
export interface LibraryDialog { id: string; title: string; account: string; peer_id: string; peer_type: string }
export type LibraryResult = { ok: true; id?: string } | { ok: false; error: string };

export function validateLibraryRules(input: LibraryRules): string | null {
  if (!input || typeof input !== "object") return "Regras inválidas.";
  if (!["album","separate"].includes(input.media_mode)) return "Formato de mídia inválido.";
  if (typeof input.button_message !== "string" || !input.button_message.trim() || input.button_message.length > 4096) return "Informe o texto que acompanha os botões, com até 4.096 caracteres.";
  if (typeof input.ai_instructions !== "string" || input.ai_instructions.length > 20000) return "Use até 20.000 caracteres nas instruções.";
  if (input.ai_enabled && !input.ai_instructions.trim()) return "Escreva as instruções para o Gemini.";
  if (!["review", "immediate", "interval"].includes(input.delivery_mode)) return "Modo de publicação inválido.";
  if (!Number.isInteger(input.interval_seconds) || input.interval_seconds < 0 || input.interval_seconds > 2592000) return "O intervalo deve ficar entre zero e 30 dias.";
  if (input.delivery_mode === "interval" && input.interval_seconds < 1) return "Informe um intervalo maior que zero.";
  if (input.start_at && !Number.isFinite(Date.parse(input.start_at))) return "Data de início inválida.";
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone }); } catch { return "Fuso horário inválido."; }
  if (typeof input.prefix !== "string" || typeof input.suffix !== "string" || input.prefix.length + input.suffix.length > 4096) return "Prefixo e assinatura devem somar até 4.096 caracteres.";
  if (!Array.isArray(input.allowed_kinds) || !input.allowed_kinds.length || input.allowed_kinds.some((kind) => !(libraryKinds as readonly string[]).includes(kind))) return "Escolha os tipos de conteúdo que deseja coletar.";
  if (!Array.isArray(input.replacements) || input.replacements.length > 100 || input.replacements.some((r) => !r || typeof r.from !== "string" || !r.from || typeof r.to !== "string" || r.from.length > 4096 || r.to.length > 4096)) return "Revise as substituições de texto e links.";
  if (!Array.isArray(input.buttons) || input.buttons.length > 20 || input.buttons.some((b) => !b || typeof b.text !== "string" || !b.text.trim() || b.text.length > 64 || !validLibraryUrl(b.url))) return "Cada botão precisa de um texto (até 64 caracteres) e um link HTTP ou HTTPS válido.";
  if ([input.ai_enabled,input.silent,input.preserve_buttons].some((v) => typeof v !== "boolean")) return "Opções de publicação inválidas.";
  return null;
}
export function validLibraryUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
