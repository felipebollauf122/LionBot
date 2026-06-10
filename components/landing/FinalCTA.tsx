export default function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-(--bg-root) border-t border-(--border-subtle)">
      {/* Background mesh */}
      <div className="absolute inset-0 grid-lines opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(255,43,214,0.16),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_40%_at_50%_0%,rgba(0,229,255,0.09),transparent)]" />
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-(--accent) to-transparent" style={{ opacity: 0.5 }} />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 lg:py-40">
        {/* Ticker */}
        <div className="overflow-hidden mb-16 opacity-40">
          <div className="ticker-track flex gap-12 whitespace-nowrap w-max">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex gap-12 items-center">
                {['FUNIL AUTOMATIZADO', 'PIX INTEGRADO', 'TRACKING AVANÇADO', 'RECUPERAÇÃO AUTOMÁTICA', 'DASHBOARD COMPLETO', 'FLUXOS INTELIGENTES'].map((item) => (
                  <span
                    key={item}
                    className="text-xs text-(--accent) tracking-[0.28em] uppercase"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {item} ·
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-4xl">
          <h2
            className="text-5xl sm:text-6xl lg:text-[72px] font-extrabold text-(--text-primary) leading-[0.95] tracking-tight mb-8"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Seu concorrente já está{' '}
            <span className="gradient-text chromatic">automatizando.</span>
            <br />
            <span className="text-(--text-ghost)">E você?</span>
          </h2>

          <p className="text-(--text-secondary) text-lg mb-10 max-w-xl">
            Sem cartão de crédito. Sem contrato. Cancele quando quiser. Leva menos de 5 minutos para começar.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <a href="/register" className="btn-primary group py-4! px-8! text-sm!">
              Criar meu bot grátis
              <svg
                className="w-4 h-4 group-hover:translate-x-0.5 transition-transform"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <span className="self-center text-sm text-(--text-muted)" style={{ fontFamily: 'var(--font-mono)' }}>
              Setup em menos de 5 minutos
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
