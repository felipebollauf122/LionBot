const pains = [
  {
    index: '01',
    title: 'Clientes sumindo',
    description:
      'Você manda o link, a pessoa some. Sem follow-up automático, você perde venda toda hora — sem nem saber quantas.',
  },
  {
    index: '02',
    title: 'Dinheiro na mesa',
    description:
      'PIX manual, sem rastreamento. Você não sabe qual anúncio converteu, qual funil funcionou, quanto perdeu ontem.',
  },
  {
    index: '03',
    title: 'Operação no limite',
    description:
      'Responder, cobrar, reenviar, recuperar — tudo na mão. Não escala. Não dorme. Não para. E ainda assim, vende menos.',
  },
]

export default function PainSection() {
  return (
    <section className="bg-(--bg-root) py-28 lg:py-36">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section label */}
        <p
          className="text-xs text-(--red) tracking-[0.22em] uppercase mb-6"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {'// O problema'}
        </p>

        <h2
          className="text-4xl sm:text-5xl font-bold text-(--text-primary) leading-tight mb-16 max-w-2xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          A realidade de quem vende{' '}
          <span className="text-(--text-ghost)">no Telegram sem automação</span>
        </h2>

        {/* Pain cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-(--border-subtle) rounded-2xl overflow-hidden mb-20">
          {pains.map((pain) => (
            <div
              key={pain.index}
              className="bg-(--bg-surface) hover:bg-(--bg-elevated) transition-colors duration-300 p-8 lg:p-10 group"
            >
              <p
                className="text-xs text-(--red) tracking-[0.18em] uppercase mb-6"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {pain.index}
              </p>
              <div className="w-8 h-px bg-(--red) mb-6 group-hover:w-16 transition-all duration-300" style={{ boxShadow: '0 0 10px var(--red-glow)' }} />
              <h3
                className="text-lg font-semibold text-(--text-primary) mb-3"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {pain.title}
              </h3>
              <p className="text-sm text-(--text-muted) leading-relaxed">{pain.description}</p>
            </div>
          ))}
        </div>

        {/* Transition statement */}
        <div className="max-w-3xl">
          <p
            className="text-3xl sm:text-4xl font-bold text-(--text-primary) leading-snug"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Existe um jeito melhor.{' '}
            <span className="gradient-text">
              E você está prestes a ver.
            </span>
          </p>
        </div>
      </div>
    </section>
  )
}
