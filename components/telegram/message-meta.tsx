import { formatClock, formatViews } from "@/lib/social-proof/format";

/**
 * Rodapé da bolha: hora e, quando há, o olhinho com a contagem de views.
 * Alinhado à direita e na mesma linha do fim do texto, como no Telegram.
 */
export function MessageMeta({
  at,
  views,
  override,
}: {
  at: Date;
  views: number;
  /** "HH:MM" fixo pelo tenant. Quando presente, ignora o cálculo do offset. */
  override?: string | null;
}) {
  const temViews = views > 0;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        float: "right",
        marginLeft: 8,
        marginTop: 4,
        color: "var(--tgc-hint)",
        fontSize: 12,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {temViews && (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          <span>{formatViews(views)}</span>
        </>
      )}
      <span>{override && override.trim() !== "" ? override : formatClock(at)}</span>
    </span>
  );
}
