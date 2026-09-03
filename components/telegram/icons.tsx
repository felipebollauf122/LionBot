/*
 * Ícones do clone, desenhados sobre as prints reais.
 *
 * Todos herdam `currentColor`; o tamanho vem do CSS de quem usa, então o mesmo
 * glifo serve ao iPhone e ao Android com as medidas de cada plataforma.
 */

/** Olho das visualizações (preenchido, com pupila vazada). */
export function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 16" fill="currentColor" aria-hidden>
      <path d="M12 0C6.6 0 2.2 3.4 0 8c2.2 4.6 6.6 8 12 8s9.8-3.4 12-8c-2.2-4.6-6.6-8-12-8Zm0 13.2A5.2 5.2 0 1 1 12 2.8a5.2 5.2 0 0 1 0 10.4Zm0-8.3a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Z" />
    </svg>
  );
}

/** Seta curva do botão de encaminhar ao lado da bolha. */
export function ShareArrowIcon({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 20" fill="currentColor" aria-hidden>
      <path d="M14 0v5.2C6.4 5.6 1.4 10.6 0 19.6c3.3-5.5 7.9-7.9 14-8v5.6l10-8.6L14 0Z" />
    </svg>
  );
}

/** "<" do botão de voltar do iPhone. */
export function ChevronBackIcon() {
  return (
    <svg width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden>
      <path d="M8.8 1.2 1.6 9l7.2 7.8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Seta de voltar do Material (Android). */
export function MaterialBackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

/** Três pontos do menu (Android). */
export function MoreVertIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="6" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="18" r="2" />
    </svg>
  );
}

/** Presente (rodapé do iPhone). */
export function GiftIcon() {
  return (
    <svg width="22" height="23" viewBox="0 0 22 23" fill="none" aria-hidden>
      <path
        d="M2.5 11.5h17V21a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-9.5ZM1 7.5h20v4H1zM11 7.5V22M11 7.5H7.2a2.6 2.6 0 1 1 2.3-3.9L11 7.5ZM11 7.5h3.8a2.6 2.6 0 1 0-2.3-3.9L11 7.5Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Lupa (rodapé do iPhone). */
export function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="8.3" cy="8.3" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m13.6 13.6 5.4 5.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Lista + alfinete da barra de mensagem fixada. */
export function PinListIcon() {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden>
      <path d="M1 4.5h6M1 8h6M1 11.5h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path
        d="M12.2 1h5.6l-1 4.3 2.2 2.5V9h-8V7.8l2.2-2.5L12.2 1ZM15 9v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Selo de verificado ao lado do título. */
export function VerifiedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-label="verificado" className="tg-verified-icon">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path d="M7 12.5 10.2 15.7 17 9" stroke="var(--tgc-verified-check)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/**
 * Rabinho da bolha. O corpo da bolha tem um raio pequeno no canto inferior
 * esquerdo; este SVG cobre esse canto e desce até a ponta, como no app.
 */
export function BubbleTail() {
  return (
    <svg className="tg-bubble__tail" viewBox="0 0 10 14" fill="currentColor" preserveAspectRatio="none" aria-hidden>
      <path d="M10 0H4v6.5c0 3.6-1.4 6.2-4 7.5h10V0Z" />
    </svg>
  );
}
