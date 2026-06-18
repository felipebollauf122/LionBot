import { LionMark } from "@/components/brand/lion-mark";

/**
 * The hero's text + CTA. Shared by all render modes (3d overlay, layered, static)
 * so the messaging and SEO content stay identical regardless of device.
 * `compact` tightens spacing when it rides over the 3D dive.
 */
export function HeroOverlay({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 ${compact ? "pt-24 pb-16" : "pt-32 pb-24"}`}>
      {/* Live badge */}
      <div className="inline-flex items-center gap-2.5 mb-10 border border-(--cyan)/25 bg-(--cyan)/[0.06] rounded-full px-4 py-1.5">
        <span className="status-dot active" style={{ width: 6, height: 6 }} />
        <span
          className="text-[11px] text-(--cyan) tracking-[0.18em] uppercase text-glow-cyan"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Sistema online · +2.400 bots rodando
        </span>
      </div>

      <h1 className="mb-8 leading-[0.92] tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
        <span className="block text-[clamp(3rem,7.5vw,5.5rem)] font-bold text-(--text-primary)">Você ainda</span>
        <span className="block text-[clamp(3rem,7.5vw,5.5rem)] font-bold text-(--text-ghost)">vende no</span>
        <span className="block text-[clamp(3rem,7.5vw,5.5rem)] font-bold text-(--text-primary)">Telegram</span>
        <span className="block text-[clamp(3rem,7.5vw,5.5rem)] font-bold gradient-text chromatic">na mão?</span>
      </h1>

      <div className="max-w-xl">
        <p className="text-lg text-(--text-secondary) leading-relaxed mb-4">
          PIX manual. Follow-up no braço. Sem rastreamento. Cada venda que você fecha custou trabalho que deveria ser automático.
        </p>
        <p className="text-base text-(--text-secondary) leading-relaxed mb-10">
          O LionBot coloca seu Telegram em{" "}
          <strong className="text-(--text-primary) font-semibold">modo piloto automático</strong> — funil, cobrança, recuperação e tracking rodando 24h sem você tocar em nada.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <a href="/register" className="btn-primary group py-3.5! px-8! text-sm!">
            Criar meu bot grátis
            <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
          <span className="self-center text-sm text-(--text-muted)" style={{ fontFamily: "var(--font-mono)" }}>
            Sem cartão · Setup em 5 min
          </span>
        </div>
      </div>
    </div>
  );
}

const stats = [
  { value: "2.400+", label: "Bots ativos agora" },
  { value: "R$ 4.2M", label: "Processados / mês" },
  { value: "38%", label: "Aumento médio de conversão" },
];

/** Stats strip — reused by the static hero and shown after the 3D dive. */
export function HeroStats() {
  return (
    <div className="relative z-20 border-t border-(--border-subtle) bg-(--bg-root)/80 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-3 divide-x divide-(--border-subtle)">
          {stats.map((s) => (
            <div key={s.label} className="py-5 sm:py-6 px-4 sm:px-8 text-center">
              <p className="text-xl sm:text-2xl text-(--text-primary) mb-0.5 stat-value">{s.value}</p>
              <p className="text-xs text-(--text-muted) tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The original static hero (no animation). Used as the reduced-motion / SSR /
 * first-paint fallback so there's always a complete, accessible hero.
 */
export function StaticHero() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-(--bg-root) flex flex-col scanlines">
      <div className="absolute bottom-0 inset-x-0 h-[55%] overflow-hidden pointer-events-none">
        <div className="synthwave-grid absolute inset-0" />
      </div>
      <div className="absolute top-[8%] left-1/2 -translate-x-1/2 w-[680px] h-[680px] rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(255,43,214,0.16),transparent_62%)]" />
      <div className="absolute top-[18%] left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full pointer-events-none bg-[radial-gradient(circle,rgba(0,229,255,0.10),transparent_60%)]" />
      <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-(--bg-root) to-transparent z-10" />

      <div className="relative z-10 flex-1 flex items-center">
        <HeroOverlay />
      </div>

      <div className="hidden lg:block absolute top-28 right-12 opacity-90 z-10" style={{ animation: "float 9s ease-in-out infinite" }}>
        <LionMark size={120} />
      </div>
    </section>
  );
}
