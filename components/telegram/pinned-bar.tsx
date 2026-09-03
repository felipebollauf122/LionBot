/**
 * Barra "Mensagem fixada", entre o cabeçalho do canal e o feed.
 * Texto vazio não renderiza nada: uma barra vazia é mais estranha que a
 * ausência dela.
 */
export function PinnedBar({ text }: { text: string }) {
  if (text.trim() === "") return null;

  return (
    <div className="tg-pinned">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="tg-pinned-title">Mensagem fixada</div>
        <div className="tg-pinned-text">{text}</div>
      </div>
      <span aria-hidden style={{ color: "var(--tgc-text)", display: "flex", flexShrink: 0 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M8 3h8l-1.5 6.5L18 13v2H6v-2l3.5-3.5L8 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M12 15v6M9 21h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </span>
    </div>
  );
}
