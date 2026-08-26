"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveBotSettings, updateBotAvatar, toggleBlackEnabled, toggleProtectContent, deleteBot, updateBotToken } from "@/lib/actions/bot-settings-actions";
import { syncBotFromTelegram } from "@/lib/actions/sync-bot-actions";
import { uploadMedia } from "@/lib/actions/upload-actions";
import { LionMark } from "@/components/brand/lion-mark";
import { TrafficFilterManager } from "@/components/dashboard/traffic-filter-manager";
import type { Bot, TrafficFilterRule } from "@/lib/types/database";
import { GATEWAYS, NOWPAYMENTS_CURRENCIES, type GatewayKind } from "@/lib/gateways";
import type { ReactNode } from "react";

interface BotSettingsFormProps {
  bot: Bot;
  isAdmin?: boolean;
  /** regras do filtro de tráfego (allow/block) — exibidas na seção de redirect */
  trafficRules?: TrafficFilterRule[];
  /** extra content rendered inside the "Avançado" section (e.g. Blacklist, admin-only) */
  children?: ReactNode;
}

type SectionKey = "info" | "facebook" | "tiktok" | "utmify" | "gateway" | "tracking" | "advanced" | "danger";

/**
 * Faz fetch ao servidor do bot e devolve JSON de forma SEGURA. Se a resposta não
 * for JSON (ex: servidor fora do ar → o proxy devolve uma página HTML de erro, ou
 * NEXT_PUBLIC_BOT_SERVER_URL caiu no fallback localhost), em vez de quebrar com
 * "Failed to execute 'json'... Unexpected token '<'", lança um erro legível.
 */
async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Não foi possível falar com o servidor do bot. Verifique se ele está no ar.");
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    // resposta HTML/texto = quase sempre 404/502 do proxy ou URL errada do servidor.
    throw new Error(
      res.status >= 500
        ? "O servidor do bot está indisponível no momento. Tente de novo em instantes."
        : `Resposta inesperada do servidor (HTTP ${res.status}). Confira a URL do servidor do bot.`,
    );
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Campo de segredo (token, api key, chave secreta): mascarado por padrão, com
 * botão de revelar. Segredo em `type="text"` fica legível em screenshot, print
 * de suporte e em quem olha por cima do ombro — e essa tela costuma ser aberta
 * junto com outra pessoa.
 *
 * Vive fora do BotSettingsForm de propósito: declarado dentro, o React
 * remontaria o componente a cada render e o input perderia o foco a cada tecla.
 *
 * O padding à direita vai inline porque o `.input` do globals.css não está em
 * @layer — regra sem layer ganha de utility do Tailwind, então um `pr-*` não
 * abriria espaço pro botão.
 */
function SecretInput({
  value,
  onChange,
  placeholder,
  className = "input",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        style={{ paddingRight: 44 }}
        autoComplete="off"
        spellCheck={false}
      />
      {/* Alvo de 32px (o ícone tem 16) porque essa tela é usada no celular e um
          botão do tamanho do ícone é quase impossível de acertar com o dedo.
          Cor em --text-muted, não --text-ghost: ghost tem 16% de opacidade e é
          pra enfeite/desabilitado — controle clicável nesse alfa some no fundo. */}
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? "Ocultar valor" : "Revelar valor"}
        title={revealed ? "Ocultar" : "Revelar"}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-(--text-muted) hover:text-foreground transition-colors"
      >
        {revealed ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

const sections = [
  { key: "info", label: "Informacoes do Bot", desc: "Status e configuracao geral", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", color: "var(--accent)" },
  { key: "facebook", label: "Facebook Ads", desc: "Pixel e Conversions API", icon: "M22 12h-4l-3 9L9 3l-3 9H2", color: "var(--cyan)" },
  { key: "tiktok", label: "TikTok Ads", desc: "Pixel e Events API", icon: "M22 12h-4l-3 9L9 3l-3 9H2", color: "var(--amber)" },
  { key: "utmify", label: "Utmify", desc: "Integracao de tracking", icon: "M22 12h-4l-3 9L9 3l-3 9H2", color: "var(--purple)" },
  { key: "gateway", label: "Gateway de pagamento", desc: "PIX e cripto — ative os que quiser", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", color: "var(--accent)" },
  { key: "tracking", label: "Pagina de Tracking", desc: "Configuracao da pagina de redirecionamento", icon: "M21 12a9 9 0 11-6.219-8.56", color: "var(--amber)" },
  { key: "advanced", label: "Avancado", desc: "Protecao, fluxo black e token", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z", color: "var(--purple)" },
  { key: "danger", label: "Zona de perigo", desc: "Excluir bot permanentemente", icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01", color: "var(--red)" },
] as const;

export function BotSettingsForm({ bot, isAdmin = false, trafficRules = [], children }: BotSettingsFormProps) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<SectionKey>("info");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const expectedConfirm = bot.bot_username ?? bot.id.slice(0, 8);
  const [isActive, setIsActive] = useState(bot.is_active);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [blackEnabled, setBlackEnabled] = useState(bot.black_enabled ?? false);
  const [togglingBlack, setTogglingBlack] = useState(false);
  const [protectContent, setProtectContent] = useState(bot.protect_content ?? true);
  const [togglingProtect, setTogglingProtect] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(bot.avatar_url ?? "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [botUsername, setBotUsername] = useState(bot.bot_username ?? "");
  const [newToken, setNewToken] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [pixelId, setPixelId] = useState(bot.facebook_pixel_id ?? "");
  const [accessToken, setAccessToken] = useState(bot.facebook_access_token ?? "");
  // Pixel reserva (aquecimento de conta) — recebe cópia dos mesmos eventos.
  const [backupEnabled, setBackupEnabled] = useState(bot.facebook_backup_enabled ?? false);
  const [pixelIdBackup, setPixelIdBackup] = useState(bot.facebook_pixel_id_backup ?? "");
  const [accessTokenBackup, setAccessTokenBackup] = useState(bot.facebook_access_token_backup ?? "");
  const [tiktokPixelId, setTiktokPixelId] = useState(bot.tiktok_pixel_id ?? "");
  const [tiktokAccessToken, setTiktokAccessToken] = useState(bot.tiktok_access_token ?? "");
  const [tiktokTestEventCode, setTiktokTestEventCode] = useState(bot.tiktok_test_event_code ?? "");
  const [sendingTiktokTest, setSendingTiktokTest] = useState(false);
  const [tiktokTestMsg, setTiktokTestMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [utmifyKey, setUtmifyKey] = useState(bot.utmify_api_key ?? "");
  const [paymentGateway, setPaymentGateway] = useState<GatewayKind>(
    GATEWAYS.some((g) => g.kind === bot.payment_gateway)
      ? (bot.payment_gateway as GatewayKind)
      : "sigilopay",
  );
  // Gateways ativos. Bot antigo (coluna nula, pré-migration 070) cai no
  // gateway que ele já usava — mesmo backfill que a migration faz no banco.
  const [enabledGateways, setEnabledGateways] = useState<GatewayKind[]>(() => {
    const stored = (bot.enabled_gateways ?? []).filter((k): k is GatewayKind =>
      GATEWAYS.some((g) => g.kind === k),
    );
    if (stored.length > 0) return stored;
    return [
      GATEWAYS.some((g) => g.kind === bot.payment_gateway)
        ? (bot.payment_gateway as GatewayKind)
        : "sigilopay",
    ];
  });
  const [sigiloPublicKey, setSigiloPublicKey] = useState(bot.sigilopay_public_key ?? "");
  const [sigiloSecretKey, setSigiloSecretKey] = useState(bot.sigilopay_secret_key ?? "");
  const [evpayApiKey, setEvpayApiKey] = useState(bot.evpay_api_key ?? "");
  const [evpayProjectId, setEvpayProjectId] = useState(bot.evpay_project_id ?? "");
  const [zuckpayClientId, setZuckpayClientId] = useState(bot.zuckpay_client_id ?? "");
  const [zuckpayClientSecret, setZuckpayClientSecret] = useState(bot.zuckpay_client_secret ?? "");
  const [nowpaymentsApiKey, setNowpaymentsApiKey] = useState(bot.nowpayments_api_key ?? "");
  const [nowpaymentsIpnSecretKey, setNowpaymentsIpnSecretKey] = useState(bot.nowpayments_ipn_secret_key ?? "");
  const [nowpaymentsPayCurrency, setNowpaymentsPayCurrency] = useState(bot.nowpayments_pay_currency ?? "usdttrc20");
  const [collectEmail, setCollectEmail] = useState(bot.collect_email_after_payment ?? false);
  const [emailRequestMessage, setEmailRequestMessage] = useState(bot.email_request_message ?? "");
  const [trackingMode, setTrackingMode] = useState<"redirect" | "prelander">(bot.tracking_mode ?? "redirect");
  const [headline, setHeadline] = useState(bot.prelander_headline ?? "");
  const [description, setDescription] = useState(bot.prelander_description ?? "");
  const [imageUrl, setImageUrl] = useState(bot.prelander_image_url ?? "");
  const [ctaText, setCtaText] = useState(bot.prelander_cta_text ?? "");
  const [redirectDisplayName, setRedirectDisplayName] = useState(bot.redirect_display_name ?? "");
  const [trackingPageIntro, setTrackingPageIntro] = useState(bot.tracking_page_intro ?? "");

  /**
   * Liga/desliga um gateway. O padrão nunca pode ser desligado (o botão fica
   * disabled) — sem essa trava dava pra salvar um bot cujo gateway padrão está
   * inativo, e todo nó de pagamento sem escolha explícita cairia num gateway
   * desligado. O server action valida isso de novo, por garantia.
   */
  const toggleGateway = (kind: GatewayKind) => {
    setEnabledGateways((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await saveBotSettings(bot.id, {
        facebook_pixel_id: pixelId,
        facebook_access_token: accessToken,
        facebook_pixel_id_backup: pixelIdBackup,
        facebook_access_token_backup: accessTokenBackup,
        facebook_backup_enabled: backupEnabled,
        tiktok_pixel_id: tiktokPixelId,
        tiktok_access_token: tiktokAccessToken,
        tiktok_test_event_code: tiktokTestEventCode,
        utmify_api_key: utmifyKey,
        payment_gateway: paymentGateway,
        enabled_gateways: enabledGateways,
        sigilopay_public_key: sigiloPublicKey,
        sigilopay_secret_key: sigiloSecretKey,
        evpay_api_key: evpayApiKey,
        evpay_project_id: evpayProjectId,
        zuckpay_client_id: zuckpayClientId,
        zuckpay_client_secret: zuckpayClientSecret,
        nowpayments_api_key: nowpaymentsApiKey,
        nowpayments_ipn_secret_key: nowpaymentsIpnSecretKey,
        nowpayments_pay_currency: nowpaymentsPayCurrency,
        collect_email_after_payment: collectEmail,
        email_request_message: emailRequestMessage,
        tracking_mode: trackingMode,
        prelander_headline: headline,
        prelander_description: description,
        prelander_image_url: imageUrl,
        prelander_cta_text: ctaText,
        redirect_display_name: redirectDisplayName,
        tracking_page_intro: trackingPageIntro,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      // Sem isso, bot.tiktok_test_event_code (usado só pra habilitar o botão
      // "Enviar evento de teste" logo abaixo) ficava com o valor antigo do
      // server component até a próxima navegação — o operador salvava o
      // código, via "Salvo com sucesso!", e o botão continuava desabilitado.
      router.refresh();
    } catch (e) {
      console.error(e);
      setSaveError(e instanceof Error ? e.message : "Erro ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await uploadMedia(fd);
      await updateBotAvatar(bot.id, url);
      setAvatarUrl(url);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    setUploadingAvatar(true);
    try {
      await updateBotAvatar(bot.id, null);
      setAvatarUrl("");
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const handleSyncFromTelegram = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncBotFromTelegram(bot.id);
      if (res.ok) {
        if (res.name) setRedirectDisplayName(res.name);
        setSyncMsg(`✓ Sincronizado: ${res.name ?? "nome"}${res.hasPhoto ? " + foto" : " (sem foto no Telegram)"}`);
        router.refresh();
      } else {
        setSyncMsg(`Erro: ${res.error ?? "falha"}`);
      }
    } catch {
      setSyncMsg("Erro ao sincronizar");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const handleToggleActive = async () => {
    setActivating(true);
    setActivateError(null);
    try {
      const rawUrl = process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001";
      // Em produção, se a env var não foi embutida no build, cairia em localhost
      // (que serve HTML → quebra o .json()). Avisa claro em vez de falhar feio.
      if (typeof window !== "undefined" && window.location.hostname !== "localhost" && rawUrl.includes("localhost")) {
        throw new Error("Configuração do servidor do bot ausente (NEXT_PUBLIC_BOT_SERVER_URL). Avise o admin.");
      }
      const serverUrl = rawUrl.replace(/\/+$/, "");
      if (!isActive) {
        const { ok, data } = await fetchJson(`${serverUrl}/api/bots/${bot.id}/register-webhook`, { method: "POST" });
        if (!ok) throw new Error((data.error as string) ?? "Erro ao ativar bot");
        setIsActive(true);
      } else {
        const { ok, data } = await fetchJson(`${serverUrl}/api/bots/${bot.id}/deactivate`, { method: "POST" });
        if (!ok) throw new Error((data.error as string) ?? "Erro ao desativar bot");
        setIsActive(false);
      }
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setActivating(false);
    }
  };

  function SectionHeader({ sKey }: { sKey: string }) {
    const s = sections.find((x) => x.key === sKey)!;
    return (
      <div className="flex items-center gap-3 mb-5">
        {sKey === "info" ? (
          <LionMark size={38} glow={false} />
        ) : (
          <div className="section-icon w-10 h-10" style={{ background: `color-mix(in srgb, ${s.color} 14%, transparent)`, boxShadow: `0 0 12px -4px ${s.color}` }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={s.icon} />
            </svg>
          </div>
        )}
        <div>
          <h2 className="text-foreground font-semibold text-sm tracking-tight">{s.label}</h2>
          <p className="text-(--text-muted) text-xs">{s.desc}</p>
        </div>
      </div>
    );
  }

  // Which sections expose fields saved by the shared "Salvar Configuracoes" button.
  const savableSections: SectionKey[] = ["facebook", "tiktok", "utmify", "gateway", "tracking"];
  const showSaveBar = savableSections.includes(activeSection);

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground tracking-tight page-title mb-1">Configuracoes</h1>
      <p className="text-(--text-secondary) text-sm mb-6 sm:mb-8">Configure as integracoes e tracking deste bot</p>

      <div className="flex flex-col lg:flex-row gap-5 lg:gap-7 items-start">
        {/* Sub-rail — section list */}
        <nav className="w-full lg:w-64 shrink-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <ul className="card p-2 flex flex-col gap-1">
            {sections.map((s) => {
              const isActiveItem = activeSection === s.key;
              const isDanger = s.key === "danger";
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setActiveSection(s.key as SectionKey)}
                    className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 ${
                      isActiveItem
                        ? "bg-white/4"
                        : "hover:bg-white/2"
                    }`}
                    style={
                      isActiveItem
                        ? {
                            border: `1px solid color-mix(in srgb, ${s.color} 30%, transparent)`,
                            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${s.color} 6%, transparent), 0 0 16px -8px ${s.color}`,
                          }
                        : { border: "1px solid transparent" }
                    }
                  >
                    <span
                      className="section-icon w-8 h-8 shrink-0 transition-transform duration-200 group-hover:scale-105"
                      style={{
                        background: `color-mix(in srgb, ${s.color} ${isActiveItem ? 16 : 10}%, transparent)`,
                        boxShadow: isActiveItem ? `0 0 12px -4px ${s.color}` : "none",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d={s.icon} />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm font-medium tracking-tight truncate ${
                          isActiveItem ? "text-foreground" : isDanger ? "text-(--red)/80 group-hover:text-(--red)" : "text-(--text-secondary) group-hover:text-foreground"
                        }`}
                      >
                        {s.label}
                      </span>
                      <span className="block text-[10px] text-(--text-ghost) truncate">{s.desc}</span>
                    </span>
                    <span
                      className={`shrink-0 transition-all duration-200 ${isActiveItem ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1"}`}
                      style={{ color: s.color }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Detail — selected section */}
        <div className="flex-1 min-w-0 w-full max-w-2xl">
          {/* ── Geral ─────────────────────────────────────────── */}
          {activeSection === "info" && (
            <div className="card p-4 sm:p-6 relative animate-in">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/15 to-transparent" />
              <SectionHeader sKey="info" />

              {/* Avatar Upload */}
              <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5 mb-6">
                <div className="relative group">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Bot avatar"
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border border-(--border-subtle)"
                      style={{ boxShadow: "0 0 20px -6px color-mix(in srgb, var(--accent) 15%, transparent)" }}
                    />
                  ) : (
                    <div
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border border-dashed border-(--border-subtle) flex items-center justify-center"
                      style={{ background: "rgba(255,255,255,0.02)" }}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-ghost)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  >
                    {uploadingAvatar ? (
                      <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    )}
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-foreground text-sm font-semibold">Foto e nome</span>
                  <span className="text-(--text-muted) text-xs">Puxe automaticamente do Telegram, ou envie uma foto sua.</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <button
                      type="button"
                      onClick={handleSyncFromTelegram}
                      disabled={syncing}
                      className="px-3 py-1.5 text-xs font-bold text-(--cyan) border border-(--cyan)/20 rounded-lg hover:bg-(--cyan)/10 transition-all disabled:opacity-50 flex items-center gap-1.5"
                      style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--cyan) 10%, transparent) 0%, transparent 100%)" }}
                    >
                      {syncing ? (
                        <span className="w-3.5 h-3.5 border-2 border-(--cyan)/40 border-t-(--cyan) rounded-full animate-spin" />
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>
                      )}
                      {syncing ? "Sincronizando..." : "Sincronizar do Telegram"}
                    </button>
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="px-3 py-1.5 text-xs font-bold text-(--accent) border border-(--accent)/15 rounded-lg hover:bg-(--accent-muted) transition-all disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, var(--accent-muted) 0%, color-mix(in srgb, var(--accent) 4%, transparent) 100%)" }}
                    >
                      {uploadingAvatar ? "Enviando..." : "Enviar foto"}
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        disabled={uploadingAvatar}
                        className="px-3 py-1.5 text-xs font-bold text-(--red) border border-(--red)/15 rounded-lg hover:bg-(--red-muted) transition-all disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)" }}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  {syncMsg && <span className="text-[11px] text-(--text-secondary) mt-1">{syncMsg}</span>}
                </div>
              </div>

              <div className="space-y-2 text-sm mb-5">
                <p className="text-(--text-secondary)">Username: <span className="text-foreground font-medium">@{bot.bot_username}</span></p>
                <p className="text-(--text-secondary) flex items-center gap-2">Status:
                  <span className={`badge ${isActive ? "badge-active" : "badge-inactive"}`}>
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${isActive ? "bg-(--accent)" : "bg-(--text-ghost)"}`} />
                    {isActive ? "Ativo" : "Inativo"}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleActive}
                  disabled={activating}
                  className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all disabled:opacity-50 ${
                    isActive
                      ? "text-(--red) border border-(--red)/15"
                      : "text-(--accent) border border-(--accent)/15"
                  }`}
                  style={isActive
                    ? { background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)", boxShadow: "0 0 12px -4px rgba(255,59,107,0.2)" }
                    : { background: "linear-gradient(135deg, var(--accent-muted) 0%, color-mix(in srgb, var(--accent) 4%, transparent) 100%)", boxShadow: "0 0 12px -4px color-mix(in srgb, var(--accent) 20%, transparent)" }
                  }
                >
                  {activating ? "Processando..." : isActive ? "Desativar Bot" : "Ativar Bot"}
                </button>
                {activateError && <span className="text-(--red) text-xs font-medium">{activateError}</span>}
              </div>
            </div>
          )}

          {/* ── Facebook ──────────────────────────────────────── */}
          {activeSection === "facebook" && (
            <div className="card p-4 sm:p-6 relative animate-in">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--cyan)/15 to-transparent" />
              <SectionHeader sKey="facebook" />
              <div className="space-y-4">
                <div>
                  <label className="input-label">Pixel ID <span className="text-(--text-ghost) font-normal">(principal)</span></label>
                  <input type="text" value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="123456789012345" className="input" />
                </div>
                <div>
                  <label className="input-label">Conversions API Token <span className="text-(--text-ghost) font-normal">(principal)</span></label>
                  <SecretInput value={accessToken} onChange={setAccessToken} placeholder="EAAx..." />
                </div>

                {/* ── Pixel reserva (aquecimento) ───────────────────── */}
                <div className="pt-4 mt-2 border-t border-(--border-subtle)">
                  <label className="flex items-center justify-between gap-3 cursor-pointer select-none mb-1">
                    <div>
                      <div className="text-foreground text-sm font-medium flex items-center gap-2">
                        🔥 Pixel reserva
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${backupEnabled ? "bg-(--cyan)/15 text-(--cyan)" : "bg-white/5 text-(--text-ghost)"}`}>
                          {backupEnabled ? "ativo" : "desligado"}
                        </span>
                      </div>
                      <div className="text-(--text-muted) text-xs mt-0.5 leading-relaxed max-w-md">
                        Envia uma <b>cópia de todos os eventos</b> pra um 2º pixel — pra aquecer uma conta nova em paralelo, sem pausa, pronta pra assumir quando você precisar trocar.
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={backupEnabled}
                      onClick={() => setBackupEnabled((v) => !v)}
                      className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${backupEnabled ? "bg-(--cyan)" : "bg-white/10"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${backupEnabled ? "translate-x-5" : ""}`} />
                    </button>
                  </label>

                  {backupEnabled && (
                    <div className="space-y-4 mt-4 animate-in">
                      <div>
                        <label className="input-label">Pixel ID <span className="text-(--cyan) font-normal">(reserva)</span></label>
                        <input type="text" value={pixelIdBackup} onChange={(e) => setPixelIdBackup(e.target.value)} placeholder="987654321098765" className="input" />
                      </div>
                      <div>
                        <label className="input-label">Conversions API Token <span className="text-(--cyan) font-normal">(reserva)</span></label>
                        <SecretInput value={accessTokenBackup} onChange={setAccessTokenBackup} placeholder="EAAx..." />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── TikTok ────────────────────────────────────────── */}
          {activeSection === "tiktok" && (
            <div className="card p-4 sm:p-6 relative animate-in">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--amber)/15 to-transparent" />
              <SectionHeader sKey="tiktok" />
              <div className="space-y-4">
                <div>
                  <label className="input-label">Pixel ID</label>
                  <input type="text" value={tiktokPixelId} onChange={(e) => setTiktokPixelId(e.target.value)} placeholder="CXXXXXXXXXXXXXXXXXXX" className="input" />
                </div>
                <div>
                  <label className="input-label">Events API Access Token</label>
                  <SecretInput value={tiktokAccessToken} onChange={setTiktokAccessToken} placeholder="token do Events Manager" />
                </div>
                <p className="text-(--text-muted) text-xs leading-relaxed">
                  Os dois saem do <b>TikTok Events Manager</b>: abra o seu pixel — o <b>Pixel ID</b> aparece
                  logo no topo — e em <b>Settings</b> clique em <b>Generate Access Token</b> pra gerar o token
                  da Events API. Copie o token na hora: o TikTok não mostra ele de novo depois.
                </p>

                {/* ── Evento de teste (pré-requisito da TikTok pra liberar o pixel numa campanha) ── */}
                <div className="pt-4 mt-2 border-t border-(--border-subtle)">
                  <div className="text-foreground text-sm font-medium mb-1">Evento de teste</div>
                  <p className="text-(--text-muted) text-xs mb-3 leading-relaxed">
                    A TikTok só libera um evento (ex: Purchase) pra otimização de campanha depois de ver
                    esse evento pelo menos uma vez. Cole o <b>Test Event Code</b> (Events Manager → seu
                    pixel → aba <b>Test Events</b>) e salve as configurações — só então o botão abaixo
                    envia um evento de teste isolado, sem tocar no funil real de nenhum bot.
                  </p>
                  <div className="mb-3">
                    <label className="input-label">Test Event Code</label>
                    <input
                      type="text"
                      value={tiktokTestEventCode}
                      onChange={(e) => setTiktokTestEventCode(e.target.value)}
                      placeholder="TEST12345"
                      className="input font-mono text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={sendingTiktokTest || !bot.tiktok_test_event_code}
                    onClick={async () => {
                      setSendingTiktokTest(true);
                      setTiktokTestMsg(null);
                      try {
                        const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "").replace(/\/+$/, "");
                        const { ok, data } = await fetchJson(`${serverUrl}/api/bots/${bot.id}/tiktok-test-event`, { method: "POST" });
                        setTiktokTestMsg({
                          kind: ok ? "ok" : "err",
                          text: ok ? String(data.message ?? "Evento de teste enviado.") : String(data.error ?? "Erro ao enviar."),
                        });
                      } catch (e) {
                        setTiktokTestMsg({ kind: "err", text: e instanceof Error ? e.message : "Erro inesperado" });
                      } finally {
                        setSendingTiktokTest(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded border border-white/15 text-white/80 text-xs hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {sendingTiktokTest ? "Enviando..." : "Enviar evento de teste"}
                  </button>
                  {!bot.tiktok_test_event_code && (
                    <p className="text-(--text-ghost) text-[10px] mt-2">
                      Cole o Test Event Code acima e clique em <b>Salvar Configurações</b> antes de testar.
                    </p>
                  )}
                  {tiktokTestMsg && (
                    <p className={`text-xs mt-2 ${tiktokTestMsg.kind === "ok" ? "text-(--accent)" : "text-red-400"}`}>
                      {tiktokTestMsg.text}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Utmify ────────────────────────────────────────── */}
          {activeSection === "utmify" && (
            <div className="card p-4 sm:p-6 relative animate-in">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--purple)/15 to-transparent" />
              <SectionHeader sKey="utmify" />
              <div>
                <label className="input-label">API Key</label>
                <SecretInput value={utmifyKey} onChange={setUtmifyKey} placeholder="utm_..." />
              </div>
            </div>
          )}

          {/* ── Gateway de pagamento ──────────────────────────── */}
          {activeSection === "gateway" && (
            <div className="card p-4 sm:p-6 relative animate-in">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/15 to-transparent" />
              <SectionHeader sKey="gateway" />
              <div className="space-y-4">
                <p className="text-white/50 text-xs leading-relaxed">
                  Ative quantos gateways quiser. No editor de fluxo, cada nó de
                  pagamento escolhe por qual deles cobrar — é assim que você
                  oferece PIX e cripto no mesmo funil, com um botão pra cada.
                </p>

                {GATEWAYS.map((g) => {
                  const active = enabledGateways.includes(g.kind);
                  const isDefault = paymentGateway === g.kind;
                  return (
                    <div
                      key={g.kind}
                      className="rounded-xl p-3 space-y-3"
                      style={{
                        background: active ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
                        border: active
                          ? "1px solid color-mix(in srgb, var(--accent) 25%, transparent)"
                          : "1px solid var(--border-subtle)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-sm font-medium">{g.label}</span>
                            {isDefault && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider text-(--accent) bg-(--accent)/12">
                                padrão
                              </span>
                            )}
                          </div>
                          <div className="text-white/40 text-[11px] mt-0.5">
                            {g.method === "crypto" ? "Criptomoeda" : "PIX"}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isDefault}
                          title={isDefault ? "Escolha outro gateway padrão antes de desativar este." : undefined}
                          onClick={() => toggleGateway(g.kind)}
                          className={`toggle-btn ${active ? "on" : "off"} disabled:opacity-40 disabled:cursor-not-allowed shrink-0`}
                        >
                          {active ? "Ativo" : "Desativado"}
                        </button>
                      </div>

                      {active && g.kind === "sigilopay" && (
                        <div className="space-y-3">
                          <div>
                            <label className="input-label">Chave Publica</label>
                            <input type="text" value={sigiloPublicKey} onChange={(e) => setSigiloPublicKey(e.target.value)} placeholder="pub_..." className="input" />
                          </div>
                          <div>
                            <label className="input-label">Chave Secreta</label>
                            <SecretInput value={sigiloSecretKey} onChange={setSigiloSecretKey} placeholder="sec_..." />
                          </div>
                        </div>
                      )}

                      {active && g.kind === "evpay" && (
                        <div className="space-y-3">
                          <div>
                            <label className="input-label">API Key (X-API-Key)</label>
                            <SecretInput value={evpayApiKey} onChange={setEvpayApiKey} placeholder="fp_sk_..." />
                          </div>
                          <div>
                            <label className="input-label">Project ID</label>
                            <input type="text" value={evpayProjectId} onChange={(e) => setEvpayProjectId(e.target.value)} placeholder="cmop4ynuc..." className="input" />
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={async () => {
                                const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "").replace(/\/+$/, "");
                                try {
                                  const { ok, data } = await fetchJson(`${serverUrl}/api/bots/${bot.id}/setup-evpay-webhook`, { method: "POST" });
                                  alert(ok ? `Webhook registrado: ${data.webhook_url}` : `Erro: ${data.error}`);
                                } catch (e) {
                                  alert(e instanceof Error ? e.message : "Erro inesperado");
                                }
                              }}
                              className="px-3 py-1.5 rounded border border-white/15 text-white/80 text-xs hover:bg-white/5"
                            >
                              Re-registrar webhook no Yvepay
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "").replace(/\/+$/, "");
                                try {
                                  const { data } = await fetchJson(`${serverUrl}/api/bots/${bot.id}/evpay-webhook-status`);
                                  alert(JSON.stringify(data, null, 2));
                                } catch (e) {
                                  alert(e instanceof Error ? e.message : "Erro inesperado");
                                }
                              }}
                              className="px-3 py-1.5 rounded border border-white/15 text-white/80 text-xs hover:bg-white/5"
                            >
                              Verificar status
                            </button>
                          </div>
                          <p className="text-xs text-white/40">
                            Salvar registra o webhook automaticamente. Use os botões acima
                            pra re-registrar ou conferir se o Yvepay tem nosso URL cadastrado.
                            Evento monitorado: <code>pix.in.confirmation</code>.
                          </p>
                        </div>
                      )}

                      {active && g.kind === "zuckpay" && (
                        <div className="space-y-3">
                          <div>
                            <label className="input-label">Client ID</label>
                            <input type="text" value={zuckpayClientId} onChange={(e) => setZuckpayClientId(e.target.value)} placeholder="..." className="input" />
                          </div>
                          <div>
                            <label className="input-label">Client Secret</label>
                            <SecretInput value={zuckpayClientSecret} onChange={setZuckpayClientSecret} placeholder="..." />
                          </div>
                        </div>
                      )}

                      {active && g.kind === "nowpayments" && (
                        <div className="space-y-3">
                          <div>
                            <label className="input-label">API Key</label>
                            <SecretInput value={nowpaymentsApiKey} onChange={setNowpaymentsApiKey} placeholder="..." />
                          </div>
                          <div>
                            <label className="input-label">IPN Secret Key</label>
                            <SecretInput value={nowpaymentsIpnSecretKey} onChange={setNowpaymentsIpnSecretKey} placeholder="..." />
                          </div>
                          <div>
                            <label className="input-label">Moeda para receber</label>
                            <select
                              value={nowpaymentsPayCurrency}
                              onChange={(e) => setNowpaymentsPayCurrency(e.target.value)}
                              className="input"
                            >
                              {NOWPAYMENTS_CURRENCIES.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                          </div>
                          <p className="text-xs text-white/40">
                            Chaves geradas em nowpayments.io → Configurações da conta → API Keys /
                            IPN. A conversão de R$ pra cripto é feita automaticamente pela
                            NOWPayments no valor de cada cobrança. Prefira USDT/TRX pra produtos
                            de ticket baixo — moedas como BTC têm valor mínimo de rede que pode
                            superar o preço do produto.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div>
                  <label className="input-label">Gateway padrão</label>
                  <select
                    value={paymentGateway}
                    onChange={(e) => setPaymentGateway(e.target.value as GatewayKind)}
                    className="input"
                  >
                    {GATEWAYS.filter((g) => enabledGateways.includes(g.kind)).map((g) => (
                      <option key={g.kind} value={g.kind}>{g.label}</option>
                    ))}
                  </select>
                  <p className="text-white/50 text-xs mt-1.5 leading-relaxed">
                    Usado quando o nó de pagamento no fluxo não escolhe nenhum —
                    inclusive em todos os fluxos que você já tem hoje.
                  </p>
                </div>
                <div className="pt-4 border-t border-white/10">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={collectEmail}
                      onChange={(e) => setCollectEmail(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-white/20 bg-black/30 accent-(--accent)"
                    />
                    <div>
                      <div className="text-white text-sm font-medium">Pedir e-mail após pagamento</div>
                      <div className="text-white/50 text-xs mt-0.5 leading-relaxed">
                        Quando ligado, após o pagamento o bot envia uma mensagem pedindo
                        o e-mail do cliente e só libera o produto / dispara Purchase no
                        Facebook quando o cliente responder (ou após 2h via timeout).
                        Quando desligado, libera o produto e dispara Purchase imediatamente.
                      </div>
                    </div>
                  </label>

                  {collectEmail && (
                    <div className="mt-4 pl-7">
                      <label className="input-label">Mensagem pedindo o e-mail</label>
                      <textarea
                        value={emailRequestMessage}
                        onChange={(e) => setEmailRequestMessage(e.target.value)}
                        placeholder={"✅ Pagamento confirmado!\n\nAntes de liberar seu acesso, preciso do seu e-mail válido para registrar sua compra.\n\n📩 Manda seu e-mail aí:"}
                        rows={6}
                        className="input text-sm w-full resize-y font-mono"
                      />
                      <p className="text-white/50 text-xs mt-1.5 leading-relaxed">
                        Essa é a mensagem que o cliente recebe no Telegram pedindo o e-mail.
                        Deixe <b>vazio</b> para usar o texto padrão. Aceita HTML do Telegram:
                        <code>&lt;b&gt;negrito&lt;/b&gt;</code>, <code>&lt;i&gt;itálico&lt;/i&gt;</code>,
                        <code>&lt;code&gt;mono&lt;/code&gt;</code>. Use quebras de linha normalmente.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Pagina de Tracking ────────────────────────────── */}
          {activeSection === "tracking" && (
            <div className="card p-4 sm:p-6 relative animate-in">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--amber)/15 to-transparent" />
              <SectionHeader sKey="tracking" />
              <div className="space-y-4">
                <div>
                  <label className="input-label">Modo</label>
                  <select value={trackingMode} onChange={(e) => setTrackingMode(e.target.value as "redirect" | "prelander")} className="input">
                    <option value="redirect">Redirect (redirecionamento direto)</option>
                    <option value="prelander">Pre-lander (pagina customizavel)</option>
                  </select>
                </div>

                {trackingMode === "redirect" && (
                  <div className="space-y-4 animate-in">
                    <div>
                      <label className="input-label">Nome exibido no redirect</label>
                      <input
                        type="text"
                        value={redirectDisplayName}
                        onChange={(e) => setRedirectDisplayName(e.target.value)}
                        placeholder="Ex: Oferta VIP"
                        className="input"
                      />
                      <p className="text-(--text-muted) text-xs mt-2">
                        Nome amigável que aparece na pagina antes do Telegram abrir. Deixe em branco para usar o @username do bot.
                      </p>
                    </div>
                    <div>
                      <label className="input-label">Texto da página de acesso</label>
                      <textarea
                        value={trackingPageIntro}
                        onChange={(e) => setTrackingPageIntro(e.target.value)}
                        rows={5}
                        placeholder="Escreva 2 parágrafos que despertem a curiosidade do cliente e expliquem o que ele vai encontrar no bot. Ex: 'Você está a um clique de receber...'"
                        className="input resize-none"
                      />
                      <p className="text-(--text-muted) text-xs mt-2">
                        Conteúdo que aparece na página antes do botão. Ajuda a <b>evitar bloqueio do Facebook</b> (página sem texto é marcada como link enganoso). Deixe em branco para usar um texto genérico padrão.
                      </p>
                    </div>

                    {/* ── Filtro de Tráfego (gerenciador completo) ──────── */}
                    <div className="pt-4 border-t border-(--border-subtle)">
                      <TrafficFilterManager
                        botId={bot.id}
                        tenantId={bot.tenant_id}
                        trafficFilterEnabled={bot.traffic_filter_enabled ?? false}
                        initialRules={trafficRules}
                        categories={{
                          tf_block_spies: bot.tf_block_spies ?? true,
                          tf_block_datacenter: bot.tf_block_datacenter ?? true,
                          tf_block_adlibrary: bot.tf_block_adlibrary ?? true,
                          tf_block_fb_crawler: bot.tf_block_fb_crawler ?? false,
                        }}
                        slugGate={{
                          enabled: bot.slug_gate_enabled ?? false,
                          slugPlain: bot.slug_plain ?? null,
                        }}
                      />
                    </div>
                  </div>
                )}

                {trackingMode === "prelander" && (
                  <div className="space-y-4 animate-in">
                    <div>
                      <label className="input-label">Titulo</label>
                      <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Bem-vindo!" className="input" />
                    </div>
                    <div>
                      <label className="input-label">Descricao</label>
                      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Descricao da oferta..." className="input resize-none" />
                    </div>
                    <div>
                      <label className="input-label">URL da Imagem</label>
                      <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." className="input" />
                    </div>
                    <div>
                      <label className="input-label">Texto do Botao CTA</label>
                      <input type="text" value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Acessar no Telegram" className="input" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Avancado (Protecao / Black / Token) ───────────── */}
          {activeSection === "advanced" && (
            <div className="space-y-5 animate-in">
              <div className="card p-4 sm:p-6 relative">
                <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--purple)/15 to-transparent" />
                <SectionHeader sKey="advanced" />

                {/* Protect Content Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="section-icon w-8 h-8" style={{ background: "color-mix(in srgb, var(--cyan) 14%, transparent)", boxShadow: "0 0 12px -4px var(--cyan)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-foreground font-semibold text-sm tracking-tight">Proteger Conteúdo</h3>
                      <p className="text-(--text-muted) text-xs">Impede encaminhar, copiar textos e salvar mídias</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      setTogglingProtect(true);
                      try {
                        await toggleProtectContent(bot.id, !protectContent);
                        setProtectContent(!protectContent);
                      } catch (e) {
                        console.error(e);
                      } finally {
                        setTogglingProtect(false);
                      }
                    }}
                    disabled={togglingProtect}
                    className={`relative w-11 h-6 rounded-full transition-all duration-200 ${protectContent ? "bg-(--cyan)" : "bg-(--border-default)"}`}
                    style={protectContent ? { boxShadow: "0 0 12px -2px var(--cyan-glow)" } : {}}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${protectContent ? "translate-x-5" : "translate-x-0"}`}
                    />
                  </button>
                </div>

                {/* Black Flow Toggle — admin only */}
                {isAdmin && (
                  <div className="mt-6 pt-5 border-t border-(--border-subtle)">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="section-icon w-8 h-8" style={{ background: "color-mix(in srgb, var(--red) 14%, transparent)", boxShadow: "0 0 12px -4px var(--red)" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-foreground font-semibold text-sm tracking-tight">Fluxo Black</h3>
                          <p className="text-(--text-muted) text-xs">Ativar fluxo alternativo para trafego pago</p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          setTogglingBlack(true);
                          try {
                            await toggleBlackEnabled(bot.id, !blackEnabled);
                            setBlackEnabled(!blackEnabled);
                          } catch (e) {
                            console.error(e);
                          } finally {
                            setTogglingBlack(false);
                          }
                        }}
                        disabled={togglingBlack}
                        className={`relative w-11 h-6 rounded-full transition-all duration-200 ${blackEnabled ? "bg-(--red)" : "bg-(--border-default)"}`}
                        style={blackEnabled ? { boxShadow: "0 0 12px -2px rgba(255,59,107,0.4)" } : {}}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${blackEnabled ? "translate-x-5" : "translate-x-0"}`}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Substituir token do Telegram (admin/owner) */}
              {isAdmin && (
                <div className="card p-4 sm:p-6 border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-amber-300 font-semibold text-sm">Substituir token do Telegram</h2>
                      <p className="text-(--text-muted) text-xs">
                        Trocou de bot no BotFather (banido, novo dono, etc)? Cole o token novo aqui. Os leads, vendas e flows ficam intactos.
                      </p>
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="input-label">Bot atual</label>
                    <div className="text-(--text-secondary) text-sm">
                      {botUsername ? <code className="text-amber-300">@{botUsername}</code> : <span className="text-(--text-ghost)">sem username</span>}
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="input-label">Token novo (BotFather)</label>
                    {/* Mascarado como os outros segredos: token do Telegram é o
                        que dá controle total do bot, e ele fica na tela depois
                        de colado até o usuário salvar. */}
                    <SecretInput
                      value={newToken}
                      onChange={(v) => {
                        setNewToken(v);
                        if (tokenMessage) setTokenMessage(null);
                      }}
                      placeholder="123456789:ABCdefGhIjKlmNoPqRsTuVwXyZ"
                      className="input font-mono text-sm"
                    />
                  </div>

                  {tokenMessage && (
                    <p className={`text-xs mb-3 ${tokenMessage.kind === "ok" ? "text-(--accent)" : "text-red-400"}`}>
                      {tokenMessage.text}
                    </p>
                  )}

                  <p className="text-(--text-ghost) text-[10px] mb-3 leading-relaxed">
                    ⚠️ <b>Importante</b>: o Telegram só permite envio (incl. remarketing) pra users que JÁ deram /start no novo bot.
                    Leads antigos vão precisar dar /start no bot novo pelo menos uma vez pra voltar a receber mensagens automáticas.
                  </p>

                  <button
                    disabled={!newToken.trim() || tokenSaving}
                    onClick={async () => {
                      if (!confirm(`Substituir o token do bot @${botUsername}? O bot vai parar de funcionar até o webhook ser re-registrado (acontece automático em segundos).`)) return;
                      setTokenSaving(true);
                      setTokenMessage(null);
                      try {
                        const r = await updateBotToken(bot.id, newToken);
                        setTokenMessage({ kind: "ok", text: `Token trocado. Bot agora é @${r.bot_username}. Webhook re-registrado.` });
                        setBotUsername(r.bot_username);
                        setNewToken("");
                      } catch (err) {
                        setTokenMessage({ kind: "err", text: err instanceof Error ? err.message : "erro" });
                      } finally {
                        setTokenSaving(false);
                      }
                    }}
                    className="px-4 py-2 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-sm font-medium hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {tokenSaving ? "Trocando..." : "Substituir token"}
                  </button>
                </div>
              )}

              {/* Blacklist (admin) — vive aqui dentro da seção Avançado */}
              {children}
            </div>
          )}

          {/* ── Zona de perigo — excluir bot ──────────────────── */}
          {activeSection === "danger" && (
            <div className="card p-4 sm:p-6 border border-red-500/30 bg-red-500/5 animate-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-red-300 font-semibold text-sm">Excluir bot</h2>
                  <p className="text-(--text-muted) text-xs">
                    Apaga permanentemente o bot, seus flows, leads, transações e blacklist. Não dá pra desfazer.
                  </p>
                </div>
              </div>

              <p className="text-(--text-secondary) text-sm mb-3">
                Pra confirmar, digite <code className="text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded">{expectedConfirm}</code> abaixo:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={expectedConfirm}
                className="input font-mono text-sm mb-3"
              />
              {deleteError && (
                <p className="text-red-400 text-xs mb-3">{deleteError}</p>
              )}
              <button
                disabled={confirmText !== expectedConfirm || deleting}
                onClick={async () => {
                  if (confirmText !== expectedConfirm) return;
                  setDeleting(true);
                  setDeleteError(null);
                  try {
                    await deleteBot(bot.id);
                    router.push("/dashboard");
                    router.refresh();
                  } catch (err) {
                    setDeleteError(err instanceof Error ? err.message : "erro ao excluir");
                    setDeleting(false);
                  }
                }}
                className="px-4 py-2 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 text-sm font-medium hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? "Excluindo..." : "Excluir bot permanentemente"}
              </button>
            </div>
          )}

          {/* Save — shared across the savable config sections */}
          {showSaveBar && (
            <div className="flex items-center gap-3 mt-5 animate-in">
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? "Salvando..." : "Salvar Configuracoes"}
              </button>
              {saved && (
                <span className="text-(--accent) text-sm font-semibold animate-in flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Salvo com sucesso!
                </span>
              )}
              {saveError && (
                <span className="text-(--red) text-sm font-medium animate-in">{saveError}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
