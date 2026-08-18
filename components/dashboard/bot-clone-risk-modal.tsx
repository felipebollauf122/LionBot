"use client";

/**
 * Modal de risco antes de lançar uma clonagem de bot — mesmo tratamento
 * visual do modal de bloqueio do crawler (traffic-filter-manager.tsx): fundo
 * vermelho/perigo, ícone de alerta, role="dialog", fecha ao clicar fora.
 * O texto aqui é deliberadamente honesto sobre os limites do filtro
 * anti-pagamento — não é uma garantia, é melhor esforço.
 */
export function BotCloneRiskModal({
  open,
  onCancel,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="botclone-risk-modal-title"
      onClick={() => {
        // Não fecha clicando fora enquanto a confirmação já está em voo
        // (createBotCloneJob/launchBotCloneJob rodando) — sem essa guarda, o
        // modal some da tela mas a criação+lançamento do job continua em
        // segundo plano e ainda navega pra tela de progresso um instante
        // depois, como se o "cancelar" não tivesse funcionado de verdade.
        if (!confirming) onCancel();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-(--red)/25 overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          background: "linear-gradient(160deg, #1a0815 0%, #12060f 100%)",
          boxShadow:
            "0 24px 80px -20px rgba(255,43,107,0.5), 0 0 0 1px rgba(255,43,107,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="absolute top-0 left-6 right-6 h-px"
          style={{ background: "linear-gradient(to right, transparent, var(--red), transparent)" }}
        />

        <div className="p-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", boxShadow: "0 0 24px -6px var(--red)" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          <h2 id="botclone-risk-modal-title" className="text-foreground font-bold text-lg tracking-tight">
            Explorar este bot automaticamente?
          </h2>
          <p className="text-(--red) text-xs font-bold uppercase tracking-wider mt-1">
            Ação 100% automática
          </p>

          <div className="mt-4 space-y-3 text-sm leading-relaxed text-(--text-secondary)">
            <p>
              A exploração é <b className="text-foreground">100% automática</b> — o EagleBot decide
              sozinho, sem perguntar pra você, em qual botão clicar. Um filtro decide o que pular
              (veja abaixo), mas nenhuma decisão de clique passa por revisão humana antes de acontecer.
            </p>
            <div
              className="rounded-xl p-3 border border-(--red)/20"
              style={{ background: "color-mix(in srgb, var(--red) 8%, transparent)" }}
            >
              <p className="text-(--text-muted) text-xs">
                O filtro anti-pagamento é <b className="text-(--red)">melhor esforço, não uma garantia</b> —
                botões óbvios tipo &quot;Comprar&quot; ou &quot;Continuar&quot; já são sempre pulados, mas
                uma frase de confirmação mais longa e incomum, ou um preço mostrado só numa imagem sem
                nenhuma palavra-chave no texto, pode passar despercebido.
              </p>
            </div>
            <p className="text-(--text-muted) text-xs">
              Se o EagleBot suspeitar de uma confirmação de pagamento depois de um clique, ele{" "}
              <b className="text-foreground">marca o nó e continua explorando</b> — não pausa sozinho.
            </p>
            <p className="text-(--text-muted) text-xs">
              Todo botão clicado ou pulado fica visível pra revisão manual antes de você ativar o fluxo
              clonado — <b className="text-foreground">nada é ativado automaticamente</b>.
            </p>
            <p className="text-(--text-muted) text-xs">
              O remarketing (mensagens que o bot manda sozinho depois) é escutado por{" "}
              <b className="text-foreground">24 horas fixas</b>.
            </p>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onCancel}
              disabled={confirming}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-foreground border border-(--border-default) hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirming}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-60"
              style={{
                background: "linear-gradient(135deg, var(--red) 0%, #c01e4a 100%)",
                boxShadow: "0 8px 24px -8px rgba(255,43,107,0.7)",
              }}
            >
              {confirming ? "Iniciando..." : "Entendi, começar exploração"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
