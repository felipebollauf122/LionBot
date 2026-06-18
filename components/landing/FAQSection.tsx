'use client'

import { useState } from 'react'

const faqs = [
  {
    question: 'Preciso saber programar?',
    answer:
      'Não. O LionBot foi construído para quem vende, não para quem programa. Tudo é configurado visualmente — sem uma linha de código.',
  },
  {
    question: 'Funciona para afiliados?',
    answer:
      'Sim. Você pode usar com qualquer produto — seu ou de terceiros — e rastrear cada fonte de tráfego de forma independente.',
  },
  {
    question: 'Quanto tempo leva para configurar?',
    answer:
      'A maioria dos usuários tem o primeiro bot ativo em menos de 5 minutos. O painel é intuitivo e guia você em cada etapa.',
  },
  {
    question: 'Tem suporte?',
    answer:
      'Sim. Suporte via chat durante horário comercial e base de conhecimento completa disponível 24h.',
  },
  {
    question: 'Funciona com qualquer nicho?',
    answer:
      'Sim. O LionBot é agnóstico de nicho. Funciona para cursos, produtos físicos, serviços e qualquer tipo de infoproduto.',
  },
]

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="bg-(--bg-root) py-28 lg:py-36 border-t border-(--border-subtle)">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-16 lg:gap-24">
          {/* Left label */}
          <div>
            <p
              className="text-xs text-(--accent) tracking-[0.22em] uppercase mb-5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {'// Dúvidas'}
            </p>
            <h2
              className="text-3xl sm:text-4xl font-bold text-(--text-primary) leading-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Perguntas
              <br />
              frequentes
            </h2>
          </div>

          {/* Accordion */}
          <div className="flex flex-col">
            {faqs.map((faq, i) => (
              <div key={faq.question} className="border-b border-(--border-subtle)">
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  className="w-full flex items-start justify-between gap-6 py-6 text-left group"
                >
                  <span
                    className="text-sm font-medium text-(--text-primary) group-hover:text-(--accent) transition-colors leading-snug"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {faq.question}
                  </span>
                  <span
                    className={`flex-shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded-full border transition-all duration-200 ${
                      openIndex === i
                        ? 'border-(--accent) text-white rotate-45'
                        : 'border-(--border-default) text-(--text-muted)'
                    }`}
                    style={openIndex === i ? { background: 'linear-gradient(135deg, var(--accent), var(--purple))', boxShadow: '0 0 12px -2px var(--accent-glow)' } : {}}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </button>

                {openIndex === i && (
                  <div className="pb-6 animate-in">
                    <p className="text-sm text-(--text-muted) leading-relaxed max-w-xl">
                      {faq.answer}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
