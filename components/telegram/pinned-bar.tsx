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
      <span aria-hidden style={{ color: "var(--tgc-hint)", fontSize: 18, lineHeight: 1 }}>
        ×
      </span>
    </div>
  );
}
