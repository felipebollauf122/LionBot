/**
 * Fundo do chat.
 *
 * O Telegram não expõe o wallpaper do usuário via SDK, então isto é uma
 * aproximação: base na cor do tema + um padrão sutil por cima. Em opacidade
 * baixa de propósito — padrão forte demais chama atenção e denuncia mais do
 * que fundo liso.
 */
export function ChatBackdrop() {
  return <div aria-hidden className="tg-chat-backdrop" />;
}
