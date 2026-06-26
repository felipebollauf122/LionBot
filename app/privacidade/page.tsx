import Link from "next/link";
import { SITE_LEGAL_NAME, CONTACT_EMAIL } from "@/lib/site";

export const metadata = {
  title: "Política de Privacidade — LionBot",
  description: "Como tratamos seus dados pessoais em conformidade com a LGPD.",
};

const UPDATED = "Junho de 2026";
const YEAR = 2026;

export default function PrivacidadePage() {
  return (
    <LegalShell title="Política de Privacidade" updated={UPDATED}>
      <p>
        Esta Política de Privacidade descreve como a <b>LionBot Assistentes Digitais</b>{" "}
        (&quot;LionBot&quot;, &quot;nós&quot;) coleta, usa, armazena e protege as informações dos usuários que
        acessam nossos assistentes virtuais no Telegram e nossas páginas de acesso. Tratamos
        seus dados em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <h2>1. Dados que coletamos</h2>
      <p>
        Ao acessar nossos serviços, podemos coletar: identificadores técnicos do dispositivo e
        do navegador (cookies, endereço IP, agente do usuário), parâmetros de origem da campanha
        (UTMs), e dados que você fornece voluntariamente durante a conversa com o assistente, como
        nome de usuário do Telegram e, quando aplicável, e-mail para envio do conteúdo solicitado.
      </p>

      <h2>2. Como usamos os dados</h2>
      <p>
        Utilizamos as informações para: entregar o conteúdo ou serviço solicitado, operar e
        melhorar nossos assistentes, mensurar a eficácia das nossas campanhas de divulgação,
        prevenir fraudes e cumprir obrigações legais. Não vendemos seus dados pessoais a terceiros.
      </p>

      <h2>3. Compartilhamento</h2>
      <p>
        Podemos compartilhar dados estritamente necessários com provedores de tecnologia que nos
        apoiam (hospedagem, processamento de pagamentos e plataformas de mensuração), sempre sob
        obrigações de confidencialidade e segurança. Dados de mensuração de campanha podem ser
        compartilhados de forma agregada e pseudonimizada com plataformas de anúncios.
      </p>

      <h2>4. Cookies</h2>
      <p>
        Usamos cookies essenciais para o funcionamento das páginas e cookies de mensuração para
        entender de onde vêm os acessos. Você pode gerenciar cookies nas configurações do seu
        navegador; a desativação de alguns cookies pode afetar a experiência.
      </p>

      <h2>5. Seus direitos (LGPD)</h2>
      <p>
        Você tem direito a confirmar a existência de tratamento, acessar, corrigir, anonimizar,
        portar ou eliminar seus dados, bem como revogar consentimento. Para exercer esses
        direitos, entre em contato pelo canal indicado no rodapé desta página.
      </p>

      <h2>6. Retenção e segurança</h2>
      <p>
        Mantemos os dados apenas pelo tempo necessário às finalidades descritas ou conforme exigido
        por lei, adotando medidas técnicas e organizacionais para proteger as informações contra
        acesso não autorizado, perda ou alteração.
      </p>

      <h2>7. Contato</h2>
      <p>
        Dúvidas sobre esta Política ou sobre seus dados podem ser enviadas para{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalShell>
  );
}

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #030815 0%, #050a1c 50%, #020614 100%)",
        color: "#dfe5ff",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial',
        padding: "48px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link href="/" style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>← Início</Link>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", margin: "18px 0 6px", color: "#fff" }}>{title}</h1>
        <p style={{ fontSize: 12.5, color: "rgba(223,229,255,0.5)", marginBottom: 28 }}>Última atualização: {updated}</p>
        <div style={{ fontSize: 14.5, lineHeight: 1.75, color: "rgba(223,229,255,0.82)" }}>{children}</div>
        <LegalFooter />
      </div>
      <style>{`h2{font-size:17px;font-weight:700;color:#fff;margin:26px 0 8px}a{color:#93c5fd}`}</style>
    </div>
  );
}

export function LegalFooter() {
  return (
    <footer style={{ marginTop: 44, paddingTop: 22, borderTop: "1px solid rgba(96,165,250,0.15)", fontSize: 12, color: "rgba(223,229,255,0.5)", lineHeight: 1.7 }}>
      <p style={{ margin: 0 }}>
        <b style={{ color: "rgba(223,229,255,0.7)" }}>{SITE_LEGAL_NAME}</b> — Plataforma de
        assistentes virtuais. CNPJ em processo de registro.
      </p>
      <p style={{ margin: "6px 0 0" }}>
        <a href="/privacidade">Política de Privacidade</a> · <a href="/termos">Termos de Uso</a> ·{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(223,229,255,0.35)" }}>
        © {YEAR} LionBot. Todos os direitos reservados.
      </p>
    </footer>
  );
}
