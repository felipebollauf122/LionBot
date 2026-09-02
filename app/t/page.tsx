import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { customAlphabet } from "nanoid";
import type { Bot } from "@/lib/types/database";
import { SITE_NAME, SITE_LEGAL_NAME, CONTACT_EMAIL, SITE_DESCRIPTION } from "@/lib/site";
import { decideTraffic } from "@/lib/traffic-filter/evaluate";
import { evaluateSlugGate } from "@/lib/traffic-filter/slug";
import { LionBotSalesPage } from "@/components/traffic-filter/lion-bot-sales-page";

interface TrackingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Metadata neutra e legítima — NÃO expõe o nome do bot (que pode ser +18) nem
// "vendas". Título genérico de página de acesso. noindex: é página de redirect
// por-clique, não conteúdo pra indexar (evita ranquear nome de bot adulto).
export const metadata = {
  title: "Acesso ao assistente",
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: `Acesso · ${SITE_NAME}`, description: SITE_DESCRIPTION },
};

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

// IMPORTANTE: o tid é re-extraído no /start do Telegram com sanitização
// `[^a-zA-Z0-9_]` (server/src/webhook/telegram.ts). O nanoid PADRÃO usa o
// alfabeto A-Za-z0-9_- (com hífen), então um tid com '-' era ALTERADO no /start
// → não batia com o tracking_event → o black flow caía no visual_flow.
// Geramos o tid só com [a-zA-Z0-9] (sem '-' e sem '_'), que sobrevive intacto.
const tidNanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 16);

function generateFbp(): string {
  const rand = Math.floor(Math.random() * 1e10);
  return `fb.1.${Date.now()}.${rand}`;
}

/**
 * Build fbc (Facebook Click ID) no formato exato da Meta.
 * Formato: fb.1.<click_unix_ms>.<fbclid>
 */
function buildFbc(fbclid: string, clickTimeMs: number): string {
  return `fb.1.${clickTimeMs}.${fbclid}`;
}

/**
 * searchParams devolve string[] quando o param aparece DUPLICADO na URL
 * (?fbclid=a&fbclid=b) — e `String([...])` vira "a,b". No fbclid isso é o pior
 * caso: gera um _fbc malformado `fb.1.<ts>.a,b` que a Meta descarta, envenenando
 * a atribuição. Pega sempre o PRIMEIRO valor (o que o anúncio anexou).
 */
function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

/**
 * Serializa uma string pra DENTRO do <script> inline do rodapé. O fbclid chega
 * cru da URL e é interpolado num literal JS entre aspas simples: sem escapar,
 * um `?fbclid=';alert(document.cookie);//` executa JS na página (XSS refletido,
 * e o atacante só precisa mandar o link /t pro alvo). JSON.stringify fecha o
 * literal; o escape de `<`/`>` impede que um `</script>` no valor feche a tag
 * antes da hora, e o de U+2028/U+2029 evita quebra de linha em engine antigo.
 */
function jsLiteral(v: string): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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
  const botId = first(search.bot);

  // Sem ?bot= (ex: o Facebook revisa o link base lionbot.online/t porque os
  // params do bot ficam no campo "Parâmetros" do anúncio): em vez da tela vazia
  // "link inválido" (que o FB lê como link enganoso e reprova), mostra a landing
  // de venda do LionBot — conteúdo legítimo da plataforma.
  if (!botId) {
    return <LionBotSalesPage />;
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

  // Bot inexistente/inativo: mesma lógica — landing de venda em vez da tela vazia,
  // pra nunca devolver uma página "quebrada" que o Facebook marque como enganosa.
  if (!bot) {
    return <LionBotSalesPage />;
  }

  const typedBot = bot as Bot;

  // ── Portão de slug secreto (chave de segurança final) ─────────────────────
  // Se ativo, só prossegue quem trouxer ?s=<slug> que bata com o hash do bot.
  // Slug errado/ausente → landing de venda (igual espião). Roda ANTES do filtro
  // de tráfego: é a camada mais forte. Slug certo NÃO dá passe livre — o
  // visitante ainda passa pelos outros filtros abaixo.
  if (typedBot.slug_gate_enabled) {
    // first() aqui também: com ?s=a&s=b o String() virava "a,b" e o portão
    // barrava um cliente legítimo cujo link chegou com o param duplicado.
    const slugFromUrl = first(search.s) || null;
    if (evaluateSlugGate(true, typedBot.slug_hash, slugFromUrl) === "block") {
      return <LionBotSalesPage />;
    }
  }

  // Click ids extraídos ANTES do filtro de tráfego: o veredito depende deles
  // (clique pago do FB traz fbclid, o do TikTok traz só ttclid).
  const fbclid = first(search.fbclid);
  // TikTok Ads acrescenta ?ttclid=... no link do anúncio (equivalente ao
  // fbclid do Meta). O cookie _ttp (TikTok Pixel) é setado pelo browser
  // quando o pixel do TikTok já rodou nesse domínio antes — raramente
  // presente numa página de redirect pura, mas capturamos se existir.
  const ttclid = first(search.ttclid);

  // ── Filtro de tráfego (allowlist/blocklist) ──────────────────────────────
  // Só roda se o bot ativou. Veredito "block" → espião vê a landing de venda
  // do LionBot (sem botão /go, sem tracking_event). Fail-open dentro de decideTraffic.
  if (typedBot.traffic_filter_enabled) {
    const hdrsForFilter = await headers();
    const verdict = await decideTraffic({
      supabase,
      tenantId: typedBot.tenant_id,
      ip: extractClientIp(hdrsForFilter),
      userAgent: hdrsForFilter.get("user-agent") ?? null,
      referer: hdrsForFilter.get("referer") ?? hdrsForFilter.get("referrer") ?? null,
      fbclid: fbclid || null,
      ttclid: ttclid || null,
      categories: {
        blockSpies: typedBot.tf_block_spies ?? true,
        blockDatacenter: typedBot.tf_block_datacenter ?? true,
        blockAdLibrary: typedBot.tf_block_adlibrary ?? true,
        blockFbCrawler: typedBot.tf_block_fb_crawler ?? false,
        blockTiktokCrawler: typedBot.tf_block_tiktok_crawler ?? false,
      },
    });
    if (verdict === "block") {
      return <LionBotSalesPage />;
    }
  }

  const utmSource = first(search.utm_source);
  const utmMedium = first(search.utm_medium);
  const utmCampaign = first(search.utm_campaign);
  const utmContent = first(search.utm_content);
  const utmTerm = first(search.utm_term);

  const cookieStore = await cookies();
  const existingFbp = cookieStore.get("_fbp")?.value;
  const fbp = existingFbp || generateFbp();
  const ttp = cookieStore.get("_ttp")?.value ?? "";

  const hdrs = await headers();
  const clientIp = extractClientIp(hdrs);
  const userAgent = hdrs.get("user-agent") ?? null;
  const acceptLanguage = hdrs.get("accept-language") ?? null;
  const referer = hdrs.get("referer") ?? hdrs.get("referrer") ?? null;
  const country = (hdrs.get("cf-ipcountry") ?? "br").toLowerCase();

  // timestamp do clique (1 por request — usado no fbc, no event e no rodapé).
  // eslint-disable-next-line react-hooks/purity
  const clickTime = Date.now();

  const existingFbc = cookieStore.get("_fbc")?.value;
  const fbcCookie = existingFbc || (fbclid ? buildFbc(fbclid, clickTime) : "");

  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const queryString = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    // Param duplicado chega como array: achata (append) em vez de descartar o
    // param inteiro — o source_url precisa refletir a URL que o cliente abriu.
    if (Array.isArray(v)) {
      for (const item of v) if (item.length > 0) queryString.append(k, item);
    } else if (typeof v === "string" && v.length > 0) {
      queryString.set(k, v);
    }
  }
  const sourceUrl = host ? `${proto}://${host}/t${queryString.toString() ? "?" + queryString.toString() : ""}` : null;

  const tid = `tid_${tidNanoid(16)}`;
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
      ttclid: ttclid || null,
      ttp: ttp || null,
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
  // Facebook vê destino transparente, não o t.me direto.
  const redirectUrl = `/go?bot=${encodeURIComponent(typedBot.id)}&tid=${encodeURIComponent(tid)}`;
  const displayName = typedBot.redirect_display_name?.trim() || typedBot.bot_username || "Bot";
  const avatar = typedBot.avatar_url ?? null;
  const year = new Date(clickTime).getUTCFullYear();

  const introText = typedBot.tracking_page_intro?.trim() || DEFAULT_INTRO;
  const introParagraphs = introText.split(/\n{2,}|\n/).map((s) => s.trim()).filter(Boolean);

  // ── NEON VAULT — direção after-dark magenta/cyan ──────────────────────────
  const C = {
    bg: "#0a0410",
    accent: "#ff2bd6",   // magenta neon
    cyan: "#22e0ff",
    gold: "#ffb84d",
    ink: "#f4e9ff",
  };

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
        padding: "40px 20px 32px",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      }}
    >
      {/* Atmosfera: névoa neon ambiente */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(680px 480px at 18% -8%, rgba(255,43,214,0.22) 0%, transparent 60%), radial-gradient(620px 520px at 92% 8%, rgba(34,224,255,0.16) 0%, transparent 58%), radial-gradient(700px 700px at 50% 120%, rgba(177,75,255,0.18) 0%, transparent 60%)` }} />
      {/* Grão/grade sutil */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.5, backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)" }} />

      <main style={{ position: "relative", width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
        {/* Eyebrow */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent, background: "rgba(255,43,214,0.08)", border: "1px solid rgba(255,43,214,0.28)", borderRadius: 999, marginBottom: 30, marginTop: 8, boxShadow: "0 0 24px -8px rgba(255,43,214,0.6)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: C.accent, boxShadow: `0 0 10px ${C.accent}`, animation: "lvPulse 1.6s ease-in-out infinite" }} />
          Acesso liberado
        </span>

        {/* ── SIGNATURE: foto do bot no portal de luz neon girando ── */}
        <div style={{ position: "relative", width: 188, height: 188, marginBottom: 26, animation: "lvRise 0.7s cubic-bezier(0.16,1,0.3,1) both" }}>
          {/* anel girando (conic) */}
          <div aria-hidden style={{ position: "absolute", inset: -7, borderRadius: 34, background: `conic-gradient(from 0deg, ${C.accent}, ${C.cyan}, ${C.gold}, ${C.accent})`, filter: "blur(2px)", animation: "lvSpin 4.5s linear infinite", opacity: 0.95 }} />
          {/* halo difuso */}
          <div aria-hidden style={{ position: "absolute", inset: -26, borderRadius: 48, background: `conic-gradient(from 0deg, ${C.accent}, ${C.cyan}, ${C.accent})`, filter: "blur(34px)", animation: "lvSpin 6s linear infinite", opacity: 0.5 }} />
          {/* moldura interna preta (revela o anel como borda) */}
          <div style={{ position: "absolute", inset: 0, borderRadius: 28, padding: 4, background: C.bg }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 24, overflow: "hidden", background: "linear-gradient(150deg, #2a0f3d 0%, #150720 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 40px rgba(255,43,214,0.18)" }}>
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt={displayName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <svg width="74" height="74" viewBox="0 0 24 24" fill={C.accent} aria-hidden style={{ filter: `drop-shadow(0 0 16px ${C.accent})` }}>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Nome do bot — display pesado com glow */}
        <h1 style={{ fontSize: "clamp(28px, 8vw, 38px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.05, textAlign: "center", margin: 0, color: "#fff", textShadow: `0 0 28px rgba(255,43,214,0.55), 0 2px 12px rgba(0,0,0,0.5)`, animation: "lvRise 0.7s 0.06s cubic-bezier(0.16,1,0.3,1) both" }}>
          {displayName}
        </h1>
        <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.02em", color: C.cyan, margin: "9px 0 0", fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', textShadow: `0 0 14px rgba(34,224,255,0.5)`, animation: "lvRise 0.7s 0.1s cubic-bezier(0.16,1,0.3,1) both" }}>
          @{typedBot.bot_username}
        </p>

        {/* ── BOTÃO: o CTA dominante ── */}
        <a
          href={redirectUrl}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 11,
            width: "100%",
            marginTop: 30,
            padding: "19px 24px",
            borderRadius: 18,
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: "0.01em",
            color: "#fff",
            textDecoration: "none",
            background: `linear-gradient(120deg, ${C.accent} 0%, #c026d3 45%, ${C.cyan} 130%)`,
            border: "1px solid rgba(255,255,255,0.22)",
            boxShadow: `0 18px 50px -12px rgba(255,43,214,0.75), 0 0 0 1px rgba(255,43,214,0.25), inset 0 1px 0 rgba(255,255,255,0.4)`,
            overflow: "hidden",
            animation: "lvRise 0.7s 0.16s cubic-bezier(0.16,1,0.3,1) both, lvGlow 2.4s ease-in-out infinite",
          }}
        >
          {/* shimmer */}
          <span aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(110deg, transparent 20%, rgba(255,255,255,0.45) 50%, transparent 80%)", transform: "translateX(-120%)", animation: "lvShimmer 3.2s ease-in-out infinite" }} />
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ position: "relative" }}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
          </svg>
          <span style={{ position: "relative" }}>Acessar no Telegram</span>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ position: "relative" }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>

        <p style={{ fontSize: 11.5, color: "rgba(244,233,255,0.45)", margin: "14px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
          Link oficial verificado · abre direto no Telegram
        </p>

        {/* ── Conteúdo explicativo (anti-bloqueio FB) — discreto ── */}
        <section style={{ width: "100%", marginTop: 30, padding: "20px 20px 4px", borderRadius: 18, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", textAlign: "left", animation: "lvRise 0.7s 0.24s cubic-bezier(0.16,1,0.3,1) both" }}>
          {introParagraphs.map((para, i) => (
            <p key={i} style={{ fontSize: 13, lineHeight: 1.62, color: "rgba(244,233,255,0.72)", margin: "0 0 12px" }}>{para}</p>
          ))}
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 16px" }}>
            {TRUST_BULLETS.map((b, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, color: "rgba(244,233,255,0.66)", marginBottom: 9, lineHeight: 1.4 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* Rodapé legal */}
      <footer style={{ position: "relative", marginTop: 26, maxWidth: 440, textAlign: "center", fontSize: 11, color: "rgba(244,233,255,0.4)", lineHeight: 1.7 }}>
        <p style={{ margin: 0 }}>
          <b style={{ color: "rgba(244,233,255,0.6)", letterSpacing: "0.04em" }}>{SITE_LEGAL_NAME}</b>
        </p>
        <p style={{ margin: "5px 0 0" }}>
          <a href="/privacidade" style={{ color: "rgba(255,43,214,0.75)" }}>Política de Privacidade</a>
          {" · "}
          <a href="/termos" style={{ color: "rgba(255,43,214,0.75)" }}>Termos de Uso</a>
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 10, color: "rgba(244,233,255,0.28)" }}>© {year} {SITE_NAME} · {CONTACT_EMAIL}</p>
      </footer>

      {/* cookies _fbp/_fbc no browser (não muda otimização) */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{
var e=document.cookie.split('; ').find(function(c){return c.indexOf('_fbp=')===0});
if(!e){document.cookie='_fbp='+${jsLiteral(fbp)}+'; path=/; max-age=7776000; SameSite=Lax';}
${fbcCookie ? `var f=document.cookie.split('; ').find(function(c){return c.indexOf('_fbc=')===0});if(!f){document.cookie='_fbc='+${jsLiteral(fbcCookie)}+'; path=/; max-age=7776000; SameSite=Lax';}` : ""}
}catch(e){}`,
        }}
      />

      <style>{`
        @keyframes lvSpin { to { transform: rotate(360deg); } }
        @keyframes lvPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes lvShimmer { 0%{transform:translateX(-120%)} 55%,100%{transform:translateX(220%)} }
        @keyframes lvGlow { 0%,100%{box-shadow:0 18px 50px -12px rgba(255,43,214,0.75),0 0 0 1px rgba(255,43,214,0.25),inset 0 1px 0 rgba(255,255,255,0.4)} 50%{box-shadow:0 22px 64px -10px rgba(255,43,214,0.95),0 0 0 1px rgba(34,224,255,0.4),inset 0 1px 0 rgba(255,255,255,0.5)} }
        @keyframes lvRise { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        a[href^="/go"]:active { transform: scale(0.98); }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
        }
      `}</style>
    </div>
  );
}
