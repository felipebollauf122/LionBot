import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { nanoid } from "nanoid";
import type { Bot } from "@/lib/types/database";

interface TrackingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Texto genérico (instiga curiosidade + dá contexto legítimo) usado quando o
 *  bot não tem um texto próprio configurado. Vira o conteúdo "substancial" da
 *  página que o Facebook escaneia pra não marcar como link de baixa qualidade. */
const DEFAULT_INTRO =
  "Você está a um clique de acessar nosso assistente virtual exclusivo no Telegram. " +
  "Lá dentro, você recebe o conteúdo que veio buscar de forma rápida, segura e direta — " +
  "sem cadastros complicados e sem enrolação.\n\n" +
  "Nosso assistente foi criado para te atender em poucos segundos: é só iniciar a conversa " +
  "e seguir as instruções na tela. Tudo acontece dentro do Telegram, o aplicativo de mensagens " +
  "mais seguro e prático do mundo. Toque no botão abaixo para começar agora mesmo.";

/** Bullets de apoio (reforçam legitimidade e contexto pro robô do Facebook). */
const TRUST_BULLETS = [
  "Acesso imediato, direto no seu Telegram",
  "Conteúdo entregue de forma automática e segura",
  "Suporte e instruções passo a passo no próprio chat",
];

function generateFbp(): string {
  const rand = Math.floor(Math.random() * 1e10);
  return `fb.1.${Date.now()}.${rand}`;
}

/**
 * Build fbc (Facebook Click ID) no formato exato da Meta.
 * Formato: fb.1.<click_unix_ms>.<fbclid>
 * Esse é o valor que vai pro user_data.fbc no CAPI e tb pro cookie _fbc
 * que o Pixel JS salvaria normalmente.
 */
function buildFbc(fbclid: string, clickTimeMs: number): string {
  return `fb.1.${clickTimeMs}.${fbclid}`;
}

function extractClientIp(hdrs: Headers): string | null {
  const candidates = [
    hdrs.get("cf-connecting-ip"),
    hdrs.get("x-real-ip"),
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim(),
    hdrs.get("x-client-ip"),
  ];
  for (const ip of candidates) {
    if (ip && ip.length > 0) return ip;
  }
  return null;
}

export default async function TrackingPage({ searchParams }: TrackingPageProps) {
  const search = await searchParams;
  const botId = String(search.bot ?? "");

  if (!botId) {
    return <InvalidLink />;
  }

  const supabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bot } = await supabase
    .from("bots")
    .select("*")
    .eq("id", botId)
    .eq("is_active", true)
    .single();

  if (!bot) {
    return <InvalidLink />;
  }

  const typedBot = bot as Bot;

  const fbclid = String(search.fbclid ?? "");
  const utmSource = String(search.utm_source ?? "");
  const utmMedium = String(search.utm_medium ?? "");
  const utmCampaign = String(search.utm_campaign ?? "");
  const utmContent = String(search.utm_content ?? "");
  const utmTerm = String(search.utm_term ?? "");

  const cookieStore = await cookies();
  const existingFbp = cookieStore.get("_fbp")?.value;
  const fbp = existingFbp || generateFbp();

  const hdrs = await headers();
  const clientIp = extractClientIp(hdrs);
  const userAgent = hdrs.get("user-agent") ?? null;
  const acceptLanguage = hdrs.get("accept-language") ?? null;
  const referer = hdrs.get("referer") ?? hdrs.get("referrer") ?? null;
  // geo-IP do Cloudflare (#14) — código ISO 2 letras, lowercase. Fallback br.
  const country = (hdrs.get("cf-ipcountry") ?? "br").toLowerCase();

  // timestamp do clique (1 por request — usado no fbc, no event e no rodapé).
  // Server component renderiza 1x por request, então é estável e correto.
  // eslint-disable-next-line react-hooks/purity
  const clickTime = Date.now();

  // _fbc real do browser — se já tem cookie do Meta, prevalece;
  // senão, deriva de fbclid+timestamp atual no formato oficial Meta.
  const existingFbc = cookieStore.get("_fbc")?.value;
  const fbcCookie = existingFbc || (fbclid ? buildFbc(fbclid, clickTime) : "");

  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const queryString = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (typeof v === "string" && v.length > 0) queryString.set(k, v);
  }
  const sourceUrl = host ? `${proto}://${host}/t${queryString.toString() ? "?" + queryString.toString() : ""}` : null;

  const tid = `tid_${nanoid(16)}`;
  // event_id do PageView — o Pixel JS no browser (#12) dispara PageView com
  // ESSE id, e o server pode reusar pra dedup browser+server.
  const pageViewEventId = `pv_${tid}`;

  await supabase.from("tracking_events").insert({
    tenant_id: typedBot.tenant_id,
    bot_id: typedBot.id,
    lead_id: null,
    event_type: "page_view",
    fbclid: fbclid || null,
    tid,
    utm_params: {
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
    },
    event_data: {
      fbp,
      fbc: fbcCookie || null,
      click_time: clickTime,
      client_ip: clientIp,
      user_agent: userAgent,
      accept_language: acceptLanguage,
      referer,
      source_url: sourceUrl,
      country,
      event_id: pageViewEventId,
    },
    sent_to_facebook: false,
    sent_to_utmify: false,
  });

  // Botão aponta pro NOSSO domínio (/go) que redireciona pro Telegram — o
  // Facebook vê destino transparente, não o t.me direto (que ele marca como
  // link enganoso). O tid carrega o tracking do clique até o /start.
  const redirectUrl = `/go?bot=${encodeURIComponent(typedBot.id)}&tid=${encodeURIComponent(tid)}`;
  const displayName = typedBot.redirect_display_name?.trim() || `@${typedBot.bot_username}`;
  const avatar = typedBot.avatar_url ?? null;

  // Texto explicativo: personalizado por bot OU genérico (conteúdo "substancial"
  // que o Facebook exige — página de ponte vazia é marcada como baixa qualidade).
  const introText = typedBot.tracking_page_intro?.trim() || DEFAULT_INTRO;
  const introParagraphs = introText.split(/\n{2,}|\n/).map((s) => s.trim()).filter(Boolean);

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background: "radial-gradient(1200px 800px at 20% 0%, #0b2a5c 0%, transparent 55%), radial-gradient(900px 700px at 90% 100%, #0a1f4a 0%, transparent 50%), linear-gradient(180deg, #030815 0%, #050a1c 50%, #020614 100%)",
        color: "#e8ecff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(96,165,250,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "-10%",
          left: "30%",
          width: "520px",
          height: "520px",
          background: "#3b82f6",
          borderRadius: "9999px",
          filter: "blur(140px)",
          opacity: 0.18,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: "-10%",
          right: "10%",
          width: "420px",
          height: "420px",
          background: "#60a5fa",
          borderRadius: "9999px",
          filter: "blur(120px)",
          opacity: 0.14,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "420px",
          borderRadius: "28px",
          padding: "40px 32px 32px",
          background:
            "linear-gradient(180deg, rgba(20,30,60,0.85) 0%, rgba(10,18,40,0.9) 100%)",
          border: "1px solid rgba(96,165,250,0.18)",
          boxShadow:
            "0 0 0 1px rgba(59,130,246,0.08) inset, 0 30px 80px -20px rgba(37,99,235,0.45), 0 0 120px -30px rgba(59,130,246,0.5)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "28px",
            padding: "1px",
            background:
              "linear-gradient(135deg, rgba(96,165,250,0.5) 0%, transparent 40%, transparent 60%, rgba(147,197,253,0.35) 100%)",
            WebkitMask:
              "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 12px",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#93c5fd",
            background: "rgba(59,130,246,0.10)",
            border: "1px solid rgba(96,165,250,0.25)",
            borderRadius: "999px",
            marginBottom: "28px",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "999px",
              background: "#60a5fa",
              boxShadow: "0 0 10px #60a5fa",
            }}
          />
          Acesso via Telegram
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: "24px" }}>
          <div
            style={{
              position: "relative",
              width: "104px",
              height: "104px",
              borderRadius: "28px",
              background:
                "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 50%, #60a5fa 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow:
                "0 18px 50px -10px rgba(59,130,246,0.55), 0 0 0 1px rgba(147,197,253,0.3), inset 0 1px 0 rgba(255,255,255,0.25)",
              overflow: "hidden",
            }}
          >
            {avatar ? (
              <img
                src={avatar}
                alt={displayName}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <svg width="52" height="52" viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
              </svg>
            )}
          </div>
        </div>

        <p
          style={{
            fontSize: "13px",
            color: "rgba(226,232,255,0.55)",
            marginBottom: "8px",
            fontWeight: 500,
          }}
        >
          Você está prestes a acessar
        </p>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            margin: 0,
            marginBottom: "6px",
            color: "#ffffff",
            textShadow: "0 2px 20px rgba(59,130,246,0.35)",
          }}
        >
          {displayName}
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: "rgba(147,197,253,0.85)",
            fontWeight: 500,
            marginBottom: "22px",
          }}
        >
          @{typedBot.bot_username}
        </p>

        {/* Conteúdo explicativo — contexto legítimo (anti "baixa qualidade") */}
        <div style={{ textAlign: "left", marginBottom: "22px" }}>
          {introParagraphs.map((para, i) => (
            <p
              key={i}
              style={{
                fontSize: "13.5px",
                lineHeight: 1.65,
                color: "rgba(226,232,255,0.78)",
                margin: i === 0 ? "0 0 12px" : "0 0 12px",
              }}
            >
              {para}
            </p>
          ))}
          <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
            {TRUST_BULLETS.map((b, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "9px",
                  fontSize: "12.5px",
                  color: "rgba(226,232,255,0.72)",
                  marginBottom: "9px",
                  lineHeight: 1.4,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }} aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        <a
          href={redirectUrl}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            width: "100%",
            padding: "16px 24px",
            borderRadius: "16px",
            fontWeight: 700,
            fontSize: "15px",
            letterSpacing: "0.01em",
            color: "#ffffff",
            background:
              "linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)",
            border: "1px solid rgba(147,197,253,0.5)",
            boxShadow:
              "0 15px 40px -10px rgba(37,99,235,0.7), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.2)",
            textDecoration: "none",
            transition: "transform 120ms ease, box-shadow 120ms ease",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
          </svg>
          <span>Acessar no Telegram</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginTop: "20px",
            padding: "12px 14px",
            borderRadius: "12px",
            background: "rgba(59,130,246,0.06)",
            border: "1px solid rgba(96,165,250,0.12)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span style={{ fontSize: "11.5px", color: "rgba(226,232,255,0.7)", textAlign: "left", lineHeight: 1.4 }}>
            Link oficial protegido. Ao clicar, o Telegram abrirá com o bot verificado.
          </span>
        </div>
      </div>

      {/* Rodapé legal — o Facebook exige Política/Termos/identificação comercial
          pra não tratar a página como link enganoso (phishing). */}
      <footer
        style={{
          position: "relative",
          marginTop: "30px",
          maxWidth: "420px",
          textAlign: "center",
          fontSize: "11px",
          color: "rgba(226,232,255,0.45)",
          lineHeight: 1.7,
        }}
      >
        <p style={{ margin: 0 }}>
          <b style={{ color: "rgba(226,232,255,0.6)" }}>LionBot Assistentes Digitais</b>
        </p>
        <p style={{ margin: "5px 0 0" }}>
          <a href="/privacidade" style={{ color: "rgba(147,197,253,0.8)" }}>Política de Privacidade</a>
          {" · "}
          <a href="/termos" style={{ color: "rgba(147,197,253,0.8)" }}>Termos de Uso</a>
        </p>
        <p style={{ margin: "8px 0 0", fontSize: "10px", color: "rgba(226,232,255,0.3)" }}>
          © {new Date(clickTime).getUTCFullYear()} LionBot · contato@lionbot.app
        </p>
      </footer>

      <script
        dangerouslySetInnerHTML={{
          __html: `try{
var e=document.cookie.split('; ').find(function(c){return c.indexOf('_fbp=')===0});
if(!e){document.cookie='_fbp=${fbp}; path=/; max-age=7776000; SameSite=Lax';}
${fbcCookie ? `var f=document.cookie.split('; ').find(function(c){return c.indexOf('_fbc=')===0});if(!f){document.cookie='_fbc=${fbcCookie}; path=/; max-age=7776000; SameSite=Lax';}` : ""}
}catch(e){}`,
        }}
      />

      {/* Meta Pixel JS (#12) DESLIGADO 2026-06-03: junto com os eventos de
          funil no CAPI, o PageView no browser introduziu sinal novo que
          coincidiu com a queda nas vendas. Revertido pro estado que vendia.
          Os cookies _fbp/_fbc continuam sendo setados acima (não mudam
          otimização). Pra religar e testar dedup browser+server no futuro,
          troque PIXEL_BROWSER_ENABLED pra true. */}
      {false && typedBot.facebook_pixel_id ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `try{
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${typedBot.facebook_pixel_id}');
fbq('track','PageView',{},{eventID:'${pageViewEventId}'});
}catch(e){}`,
          }}
        />
      ) : null}
    </div>
  );
}

function InvalidLink() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(180deg, #030815 0%, #020614 100%)",
        color: "rgba(226,232,255,0.5)",
        fontSize: "14px",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto',
      }}
    >
      Link invalido
    </div>
  );
}
