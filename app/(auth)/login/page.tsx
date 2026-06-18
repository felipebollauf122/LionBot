import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { LionMark } from "@/components/brand/lion-mark";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row relative overflow-hidden">
      {/* Global ambient orbs */}
      <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-(--accent) rounded-full opacity-[0.03] blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-30%] left-[-15%] w-[500px] h-[500px] bg-(--cyan) rounded-full opacity-[0.02] blur-[120px] pointer-events-none" />

      {/* Left — form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-8 relative z-10">
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </div>

      {/* Right — decorative panel */}
      <div className="hidden lg:flex w-[520px] relative overflow-hidden">
        {/* Deep layered background */}
        <div className="absolute inset-0 bg-gradient-to-br from-(--bg-surface) via-(--bg-elevated) to-(--bg-root)" />
        <div className="grid-lines absolute inset-0 opacity-40" />
        <div className="dot-pattern absolute inset-0 opacity-30" />

        {/* Floating orbs */}
        <div className="absolute top-[15%] right-[20%] w-48 h-48 bg-(--accent) rounded-full opacity-[0.06] blur-[80px]" style={{ animation: "float 8s ease-in-out infinite" }} />
        <div className="absolute bottom-[25%] left-[15%] w-32 h-32 bg-(--cyan) rounded-full opacity-[0.05] blur-[60px]" style={{ animation: "float 10s ease-in-out infinite 2s" }} />
        <div className="absolute top-[60%] right-[10%] w-24 h-24 bg-(--purple) rounded-full opacity-[0.04] blur-[50px]" style={{ animation: "float 12s ease-in-out infinite 4s" }} />

        {/* Top glow line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-(--accent)/30 to-transparent" />
        {/* Left border glow */}
        <div className="absolute top-0 left-0 bottom-0 w-px bg-gradient-to-b from-transparent via-(--border-default) to-transparent" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center justify-center px-14 w-full">
          {/* Logo with glow */}
          <div className="relative mb-10">
            <LionMark size={104} />
            {/* Orbital ring */}
            <div className="absolute inset-[-12px] border border-(--cyan)/8 rounded-full" style={{ animation: "pulse-ring 3s ease-in-out infinite" }} />
          </div>

          <h2 className="text-2xl font-bold text-foreground mb-3 tracking-tight page-title text-center">
            Vendas no piloto automatico
          </h2>
          <p className="text-(--text-secondary) text-sm leading-relaxed text-center max-w-[280px]">
            Bots de Telegram com funil de vendas, pagamento Pix integrado, tracking e remarketing.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 mt-8 justify-center">
            {["Funil Automatico", "Pix Integrado", "Remarketing"].map((f) => (
              <span key={f} className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-(--text-muted) bg-white/3 border border-(--border-subtle) rounded-full">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-(--bg-root) to-transparent" />
      </div>
    </div>
  );
}
