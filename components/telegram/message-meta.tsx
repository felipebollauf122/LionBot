import { formatClock, formatViews } from "@/lib/social-proof/format";
import { EyeIcon } from "@/components/telegram/icons";

export type MetaVariant = "corner" | "overlay" | "line" | "inline";

/**
 * Rodapé da bolha: olhinho com views (quando há) e hora.
 *
 * - `corner`: canto inferior direito do texto, como o Telegram desenha.
 * - `overlay`: pílula translúcida sobre a mídia, para mensagem só de mídia.
 * - `line`: linha própria alinhada à direita (depois das reações / áudio).
 * - `inline`: sem posicionamento, para quem monta o layout por fora.
 */
export function MessageMeta({
  at,
  views,
  override,
  variant = "inline",
}: {
  at: Date;
  views: number;
  /** "HH:MM" fixo pelo tenant. Quando presente, ignora o cálculo do offset. */
  override?: string | null;
  variant?: MetaVariant;
}) {
  const temViews = views > 0;
  const hora = override && override.trim() !== "" ? override : formatClock(at);

  const inner = (
    <span className={`tg-meta${variant === "line" ? "" : ` tg-meta--${variant}`}`}>
      {temViews && (
        <>
          <EyeIcon className="tg-meta__eye" />
          <span>{formatViews(views)}</span>
        </>
      )}
      <span>{hora}</span>
    </span>
  );

  if (variant === "line") return <div className="tg-meta--line">{inner}</div>;
  return inner;
}

/**
 * Largura aproximada que o meta ocupa, para reservar espaço no fim da
 * última linha do texto. Superestimar 2-3px é inofensivo; subestimar faz a
 * hora cobrir a última palavra.
 */
export function estimateMetaWidth(views: number, override?: string | null): number {
  const hora = override && override.trim() !== "" ? override : "00:00";
  const porChar = 6.8;
  let w = hora.length * porChar + 8;
  if (views > 0) w += 16 + 5 + formatViews(views).length * porChar + 5;
  return Math.ceil(w);
}
