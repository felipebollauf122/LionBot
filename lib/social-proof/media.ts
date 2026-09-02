import type { MediaItem, MessageKind } from "@/lib/social-proof/types";

const TIPOS_VALIDOS = new Set(["photo", "video", "audio"]);

/**
 * Normaliza a mídia de uma mensagem.
 *
 * A coluna `media` (jsonb) é a fonte nova. As colunas `media_url`/`media_type`
 * da 071 continuam na tabela e servem de fallback para qualquer linha que o
 * backfill da 073 não tenha pego — a lista nova sempre ganha quando existe.
 *
 * O 'image' legado vira 'photo': o mockup nomeia o botão "Foto", e manter dois
 * nomes para a mesma coisa espalharia condicionais por toda a UI.
 *
 * Nunca lança: entrada malformada vira lista vazia. Isto lê jsonb, que o
 * Postgres não valida contra o nosso formato.
 */
export function normalizeMedia(
  raw: unknown,
  legacyUrl?: string | null,
  legacyType?: string | null,
): MediaItem[] {
  const lista = Array.isArray(raw) ? raw : [];

  const itens: MediaItem[] = [];
  for (const bruto of lista) {
    if (typeof bruto !== "object" || bruto === null) continue;
    const { url, type, durationSeconds } = bruto as Record<string, unknown>;
    if (typeof url !== "string" || url === "") continue;
    if (typeof type !== "string" || !TIPOS_VALIDOS.has(type)) continue;

    const item: MediaItem = { url, type: type as MediaItem["type"] };
    if (typeof durationSeconds === "number" && Number.isFinite(durationSeconds)) {
      item.durationSeconds = durationSeconds;
    }
    itens.push(item);
  }

  if (itens.length > 0) return itens;

  // Fallback nas colunas da 071.
  if (typeof legacyUrl === "string" && legacyUrl !== "" && typeof legacyType === "string") {
    const tipo = legacyType === "image" ? "photo" : legacyType;
    if (TIPOS_VALIDOS.has(tipo)) {
      return [{ url: legacyUrl, type: tipo as MediaItem["type"] }];
    }
  }

  return [];
}

/**
 * Deduz o `kind` a partir da mídia. Duas ou mais peças é sempre álbum,
 * independente de misturar foto e vídeo — é como o Telegram agrupa.
 */
export function kindFromMedia(media: MediaItem[], _hasText: boolean): MessageKind {
  if (media.length === 0) return "text";
  if (media.length > 1) return "album";
  return media[0].type;
}

/** Duração no formato do Telegram: m:ss, sem hora separada. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}
