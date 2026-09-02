/**
 * Fundo do chat.
 *
 * O Telegram não expõe o wallpaper do usuário via SDK, então isto é uma
 * aproximação: base na cor do tema + um padrão sutil por cima. Em opacidade
 * baixa de propósito — padrão forte demais chama atenção e denuncia mais do
 * que fundo liso.
 */
export function ChatBackdrop() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        background: "var(--tgc-bg)",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.035' stroke-width='1.5'%3E%3Ccircle cx='30' cy='30' r='11'/%3E%3Ccircle cx='90' cy='90' r='11'/%3E%3Cpath d='M60 8c6 8 6 16 0 24-6 8-6 16 0 24'/%3E%3Cpath d='M12 72c8 6 16 6 24 0'/%3E%3Cpath d='M84 36c8 6 16 6 24 0'/%3E%3C/g%3E%3C/svg%3E")`,
        backgroundSize: "120px 120px",
      }}
    />
  );
}
