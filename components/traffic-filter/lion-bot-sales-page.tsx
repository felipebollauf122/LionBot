import Link from "next/link";
import { SITE_NAME, SITE_LEGAL_NAME, CONTACT_EMAIL } from "@/lib/site";

const C = {
  bg: "#0a0410",
  accent: "#ff2bd6",
  cyan: "#22e0ff",
  ink: "#f4e9ff",
};

const BENEFITS = [
  "Automatize vendas no Telegram 24/7 — sem operador",
  "PIX integrado: cliente paga e recebe o acesso na hora",
  "Remarketing automático para quem não comprou",
  "Painel com métricas reais de cliques, leads e vendas",
];

export function LionBotSalesPage() {
  return (
    <div
      style={{
        minHeight: "100svh",
        position: "relative",
        overflow: "hidden",
        background: C.bg,
        color: C.ink,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px 32px",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial',
      }}
    >
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(680px 480px at 18% -8%, rgba(255,43,214,0.22) 0%, transparent 60%), radial-gradient(620px 520px at 92% 8%, rgba(34,224,255,0.16) 0%, transparent 58%)` }} />

      <main style={{ position: "relative", width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.cyan, background: "rgba(34,224,255,0.08)", border: "1px solid rgba(34,224,255,0.28)", borderRadius: 999, marginBottom: 28 }}>
          Plataforma de bots de vendas
        </span>

        <h1 style={{ fontSize: "clamp(30px, 8vw, 46px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.05, textAlign: "center", margin: 0, color: "#fff", textShadow: `0 0 28px rgba(255,43,214,0.55)`, animation: "lvRise 0.7s cubic-bezier(0.16,1,0.3,1) both" }}>
          Crie seu próprio bot de vendas no Telegram
        </h1>

        <p style={{ fontSize: 16, lineHeight: 1.6, color: "rgba(244,233,255,0.75)", textAlign: "center", margin: "18px 0 0", maxWidth: 440 }}>
          O {SITE_NAME} é a plataforma que automatiza captação, venda e remarketing
          direto no Telegram. Monte o seu em minutos — sem código.
        </p>

        <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 0", width: "100%", maxWidth: 440 }}>
          {BENEFITS.map((b, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, fontSize: 14.5, color: "rgba(244,233,255,0.82)", marginBottom: 13, lineHeight: 1.45 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <Link
          href="/"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 11,
            width: "100%", maxWidth: 440, marginTop: 32, padding: "18px 24px", borderRadius: 18,
            fontWeight: 800, fontSize: 16, color: "#fff", textDecoration: "none",
            background: `linear-gradient(120deg, ${C.accent} 0%, #c026d3 45%, ${C.cyan} 130%)`,
            border: "1px solid rgba(255,255,255,0.22)",
            boxShadow: `0 18px 50px -12px rgba(255,43,214,0.75), inset 0 1px 0 rgba(255,255,255,0.4)`,
            animation: "lvRise 0.7s 0.16s cubic-bezier(0.16,1,0.3,1) both, lvGlow 2.4s ease-in-out infinite",
          }}
        >
          Conhecer o {SITE_NAME}
        </Link>
      </main>

      <footer style={{ position: "relative", marginTop: 30, maxWidth: 440, textAlign: "center", fontSize: 11, color: "rgba(244,233,255,0.4)", lineHeight: 1.7 }}>
        <p style={{ margin: 0 }}><b style={{ color: "rgba(244,233,255,0.6)" }}>{SITE_LEGAL_NAME}</b></p>
        <p style={{ margin: "5px 0 0", fontSize: 10, color: "rgba(244,233,255,0.28)" }}>{CONTACT_EMAIL}</p>
      </footer>

      <style>{`
        @keyframes lvGlow { 0%,100%{box-shadow:0 18px 50px -12px rgba(255,43,214,0.75),inset 0 1px 0 rgba(255,255,255,0.4)} 50%{box-shadow:0 22px 64px -10px rgba(255,43,214,0.95),inset 0 1px 0 rgba(255,255,255,0.5)} }
        @keyframes lvRise { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:0.01ms !important; animation-iteration-count:1 !important; } }
      `}</style>
    </div>
  );
}
