import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { LionMark } from "@/components/brand/lion-mark";

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* Global ambient orbs */}
      <div className="absolute top-[-15%] left-[-10%] w-[500px] h-[500px] bg-(--cyan) rounded-full opacity-[0.025] blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-(--accent) rounded-full opacity-[0.03] blur-[150px] pointer-events-none" />

      {/* Left — form */}
      <div className="flex-1 flex items-center justify-center px-8 relative z-10">
        <Suspense>
          <AuthForm mode="register" />
        </Suspense>
      </div>

      {/* Right — decorative panel */}
      <div className="hidden lg:flex w-[520px] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-bl from-(--bg-surface) via-(--bg-elevated) to-(--bg-root)" />
        <div className="grid-lines absolute inset-0 opacity-40" />
        <div className="dot-pattern absolute inset-0 opacity-30" />

        {/* Floating orbs */}
        <div className="absolute top-[20%] left-[25%] w-40 h-40 bg-(--cyan) rounded-full opacity-[0.05] blur-[70px]" style={{ animation: "float 9s ease-in-out infinite" }} />
        <div className="absolute bottom-[20%] right-[20%] w-36 h-36 bg-(--accent) rounded-full opacity-[0.06] blur-[70px]" style={{ animation: "float 11s ease-in-out infinite 3s" }} />

        {/* Border glows */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-(--cyan)/20 to-transparent" />
        <div className="absolute top-0 left-0 bottom-0 w-px bg-gradient-to-b from-transparent via-(--border-default) to-transparent" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center px-14 w-full">
          <div className="relative mb-10">
            <LionMark size={104} />
            <div className="absolute -inset-3 border border-(--cyan)/8 rounded-full" style={{ animation: "pulse-ring 3s ease-in-out infinite" }} />
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-3 tracking-tight page-title text-center">
            Comece em minutos
          </h2>
          <p className="text-(--text-secondary) text-sm leading-relaxed text-center max-w-[280px]">
            Configure seu bot, conecte o pagamento Pix e comece a vender — sem saber programar.
          </p>

          {/* Steps */}
          <div className="mt-10 space-y-4 w-full max-w-[260px]">
            {[
              { n: "1", t: "Crie seu bot no Telegram" },
              { n: "2", t: "Conecte o pagamento Pix" },
              { n: "3", t: "Monte o funil de vendas" },
            ].map((s) => (
              <div key={s.n} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-(--accent-muted) border border-(--accent)/10 flex items-center justify-center text-(--accent) text-xs font-bold stat-value shrink-0">
                  {s.n}
                </div>
                <span className="text-(--text-secondary) text-sm">{s.t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-(--bg-root) to-transparent" />
      </div>
    </div>
  );
}
