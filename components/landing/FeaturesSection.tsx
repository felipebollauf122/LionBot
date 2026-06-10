const features = [
  {
    index: '01',
    title: 'Funil Automatizado',
    description:
      'Sequências de mensagens que guiam o lead do interesse à compra sem você tocar em nada. Cada etapa, na hora certa.',
    accent: 'var(--accent)',
  },
  {
    index: '02',
    title: 'Pagamento Integrado — PIX',
    description:
      'Cobrança gerada automaticamente dentro do chat. O cliente paga sem sair do Telegram. Zero fricção, mais conversão.',
    accent: 'var(--cyan)',
  },
  {
    index: '03',
    title: 'Tracking Avançado',
    description:
      'Saiba exatamente qual campanha, criativo e fonte gerou cada venda. Dados reais para decisões reais.',
    accent: 'var(--purple)',
  },
  {
    index: '04',
    title: 'Fluxos Inteligentes',
    description:
      'Lógica condicional nativa: o bot age diferente dependendo do que o lead fez, clicou ou respondeu.',
    accent: 'var(--accent)',
  },
  {
    index: '05',
    title: 'Recuperação Automática',
    description:
      'Carrinho abandonado? O bot detecta, segue o lead e tenta a recuperação no momento certo — sem você fazer nada.',
    accent: 'var(--cyan)',
  },
  {
    index: '06',
    title: 'Dashboard Completo',
    description:
      'Visão em tempo real de faturamento, conversão, leads ativos e performance por bot. Tudo em um painel.',
    accent: 'var(--purple)',
  },
]

export default function FeaturesSection() {
  return (
    <section id="produto" className="bg-(--bg-root) py-28 lg:py-36 border-t border-(--border-subtle)">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-16">
          <div>
            <p
              className="text-xs text-(--accent) tracking-[0.22em] uppercase mb-5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {'// O produto'}
            </p>
            <h2
              className="text-4xl sm:text-5xl font-bold text-(--text-primary) leading-tight max-w-lg"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Seis módulos.{' '}
              <span className="gradient-text">Um único painel.</span>
            </h2>
          </div>
          <p className="text-(--text-muted) text-base max-w-xs lg:text-right leading-relaxed">
            Cada módulo foi construído para eliminar uma tarefa manual do seu processo de vendas.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-(--border-subtle) rounded-2xl overflow-hidden">
          {features.map((f) => (
            <div
              key={f.index}
              className="relative bg-(--bg-surface) hover:bg-(--bg-elevated) transition-colors duration-300 p-8 group overflow-hidden"
            >
              {/* Hover glow */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `radial-gradient(ellipse at top left, color-mix(in srgb, ${f.accent} 10%, transparent), transparent 60%)` }}
              />
              {/* Top neon line on hover */}
              <div
                className="absolute top-0 left-0 right-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `linear-gradient(90deg, transparent, ${f.accent}, transparent)` }}
              />

              <div className="relative">
                <p
                  className="text-xs tracking-[0.18em] uppercase mb-5"
                  style={{ fontFamily: 'var(--font-mono)', color: f.accent }}
                >
                  {f.index}
                </p>
                <h3
                  className="text-base font-semibold text-(--text-primary) mb-3 leading-snug"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {f.title}
                </h3>
                <p className="text-sm text-(--text-muted) leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
