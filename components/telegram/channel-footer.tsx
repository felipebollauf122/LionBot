/**
 * Barra inferior do canal. Decorativa: dentro do Mini App não há canal real
 * pra silenciar ou seguir, mas a ausência dessa barra é justamente o que faz o
 * feed parecer uma página em vez de um chat.
 *
 * Sem handler de clique de propósito — botão que não faz nada é menos
 * estranho que botão que faz algo inesperado.
 */
export function ChannelFooter() {
  return (
    <footer
      style={{
        position: "relative",
        zIndex: 2,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "12px 16px",
        paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
        background: "var(--tgc-secondary-bg)",
        borderTop: "1px solid rgba(0,0,0,0.2)",
        color: "var(--tgc-hint)",
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: 0.2,
      }}
    >
      <span aria-hidden style={{ marginRight: 8 }}>
        🔇
      </span>
      Silenciar
    </footer>
  );
}
