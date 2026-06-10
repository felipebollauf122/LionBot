"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { saveBotSettings, updateBotAvatar, toggleBlackEnabled, toggleProtectContent, deleteBot, updateBotToken } from "@/lib/actions/bot-settings-actions";
import { uploadMedia } from "@/lib/actions/upload-actions";
import { LionMark } from "@/components/brand/lion-mark";
import type { Bot } from "@/lib/types/database";
import type { ReactNode } from "react";

interface BotSettingsFormProps {
  bot: Bot;
  isAdmin?: boolean;
  /** extra content rendered inside the "Avançado" section (e.g. Blacklist, admin-only) */
  children?: ReactNode;
}

type SectionKey = "info" | "facebook" | "utmify" | "gateway" | "tracking" | "advanced" | "danger";

const sections = [
  { key: "info", label: "Informacoes do Bot", desc: "Status e configuracao geral", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z", color: "var(--accent)" },
  { key: "facebook", label: "Facebook Ads", desc: "Pixel e Conversions API", icon: "M22 12h-4l-3 9L9 3l-3 9H2", color: "var(--cyan)" },
  { key: "utmify", label: "Utmify", desc: "Integracao de tracking", icon: "M22 12h-4l-3 9L9 3l-3 9H2", color: "var(--purple)" },
  { key: "gateway", label: "Gateway de pagamento", desc: "Poseidon Pay ou EvPay", icon: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", color: "var(--accent)" },
  { key: "tracking", label: "Pagina de Tracking", desc: "Configuracao da pagina de redirecionamento", icon: "M21 12a9 9 0 11-6.219-8.56", color: "var(--amber)" },
  { key: "advanced", label: "Avancado", desc: "Protecao, fluxo black e token", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z", color: "var(--purple)" },
  { key: "danger", label: "Zona de perigo", desc: "Excluir bot permanentemente", icon: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01", color: "var(--red)" },
] as const;

export function BotSettingsForm({ bot, isAdmin = false, children }: BotSettingsFormProps) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<SectionKey>("info");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
  const [utmifyKey, setUtmifyKey] = useState(bot.utmify_api_key ?? "");
  const [paymentGateway, setPaymentGateway] = useState<"sigilopay" | "evpay">(
    (bot.payment_gateway === "evpay" ? "evpay" : "sigilopay"),
  );
  const [sigiloPublicKey, setSigiloPublicKey] = useState(bot.sigilopay_public_key ?? "");
  const [sigiloSecretKey, setSigiloSecretKey] = useState(bot.sigilopay_secret_key ?? "");
  const [evpayApiKey, setEvpayApiKey] = useState(bot.evpay_api_key ?? "");
  const [evpayProjectId, setEvpayProjectId] = useState(bot.evpay_project_id ?? "");
  const [collectEmail, setCollectEmail] = useState(bot.collect_email_after_payment ?? false);
  const [emailRequestMessage, setEmailRequestMessage] = useState(bot.email_request_message ?? "");
  const [trackingMode, setTrackingMode] = useState<"redirect" | "prelander">(bot.tracking_mode ?? "redirect");
  const [headline, setHeadline] = useState(bot.prelander_headline ?? "");
  const [description, setDescription] = useState(bot.prelander_description ?? "");
  const [imageUrl, setImageUrl] = useState(bot.prelander_image_url ?? "");
  const [ctaText, setCtaText] = useState(bot.prelander_cta_text ?? "");
  const [redirectDisplayName, setRedirectDisplayName] = useState(bot.redirect_display_name ?? "");

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveBotSettings(bot.id, {
        facebook_pixel_id: pixelId,
        facebook_access_token: accessToken,
        utmify_api_key: utmifyKey,
        payment_gateway: paymentGateway,
        sigilopay_public_key: sigiloPublicKey,
        sigilopay_secret_key: sigiloSecretKey,
        evpay_api_key: evpayApiKey,
        evpay_project_id: evpayProjectId,
        collect_email_after_payment: collectEmail,
        email_request_message: emailRequestMessage,
        tracking_mode: trackingMode,
        prelander_headline: headline,
        prelander_description: description,
        prelander_image_url: imageUrl,
        prelander_cta_text: ctaText,
        redirect_display_name: redirectDisplayName,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error(e);
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

  const handleToggleActive = async () => {
    setActivating(true);
    setActivateError(null);
    try {
      const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
      if (!isActive) {
        const res = await fetch(`${serverUrl}/api/bots/${bot.id}/register-webhook`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao ativar bot");
        setIsActive(true);
      } else {
        const res = await fetch(`${serverUrl}/api/bots/${bot.id}/deactivate`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Erro ao desativar bot");
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
  const savableSections: SectionKey[] = ["facebook", "utmify", "gateway", "tracking"];
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
                      style={{ boxShadow: "0 0 20px -6px rgba(255,43,214,0.15)" }}
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
                  <span className="text-foreground text-sm font-semibold">Foto de Perfil</span>
                  <span className="text-(--text-muted) text-xs">JPG, PNG, WebP ou GIF. Max 50MB.</span>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="px-3 py-1.5 text-xs font-bold text-(--accent) border border-(--accent)/15 rounded-lg hover:bg-(--accent-muted) transition-all disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, var(--accent-muted) 0%, rgba(255,43,214,0.04) 100%)" }}
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
                    : { background: "linear-gradient(135deg, var(--accent-muted) 0%, rgba(255,43,214,0.04) 100%)", boxShadow: "0 0 12px -4px rgba(255,43,214,0.2)" }
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
                  <label className="input-label">Pixel ID</label>
                  <input type="text" value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="123456789012345" className="input" />
                </div>
                <div>
                  <label className="input-label">Conversions API Token</label>
                  <input type="text" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAAx..." className="input" />
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
                <input type="text" value={utmifyKey} onChange={(e) => setUtmifyKey(e.target.value)} placeholder="utm_..." className="input" />
              </div>
            </div>
          )}

          {/* ── Gateway de pagamento ──────────────────────────── */}
          {activeSection === "gateway" && (
            <div className="card p-4 sm:p-6 relative animate-in">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/15 to-transparent" />
              <SectionHeader sKey="gateway" />
              <div className="space-y-4">
                <div>
                  <label className="input-label">Gateway</label>
                  <select
                    value={paymentGateway}
                    onChange={(e) => setPaymentGateway(e.target.value as "sigilopay" | "evpay")}
                    className="input"
                  >
                    <option value="sigilopay">Poseidon Pay</option>
                    <option value="evpay">EvPay</option>
                  </select>
                </div>

                {paymentGateway === "sigilopay" && (
                  <>
                    <div>
                      <label className="input-label">Chave Publica</label>
                      <input type="text" value={sigiloPublicKey} onChange={(e) => setSigiloPublicKey(e.target.value)} placeholder="pub_..." className="input" />
                    </div>
                    <div>
                      <label className="input-label">Chave Secreta</label>
                      <input type="text" value={sigiloSecretKey} onChange={(e) => setSigiloSecretKey(e.target.value)} placeholder="sec_..." className="input" />
                    </div>
                  </>
                )}

                {paymentGateway === "evpay" && (
                  <>
                    <div>
                      <label className="input-label">API Key (X-API-Key)</label>
                      <input type="text" value={evpayApiKey} onChange={(e) => setEvpayApiKey(e.target.value)} placeholder="fp_sk_..." className="input" />
                    </div>
                    <div>
                      <label className="input-label">Project ID</label>
                      <input type="text" value={evpayProjectId} onChange={(e) => setEvpayProjectId(e.target.value)} placeholder="cmop4ynuc..." className="input" />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "").replace(/\/+$/, "");
                          const r = await fetch(`${serverUrl}/api/bots/${bot.id}/setup-evpay-webhook`, { method: "POST" });
                          const j = await r.json();
                          alert(r.ok ? `Webhook registrado: ${j.webhook_url}` : `Erro: ${j.error}`);
                        }}
                        className="px-3 py-1.5 rounded border border-white/15 text-white/80 text-xs hover:bg-white/5"
                      >
                        Re-registrar webhook no Yvepay
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "").replace(/\/+$/, "");
                          const r = await fetch(`${serverUrl}/api/bots/${bot.id}/evpay-webhook-status`);
                          const j = await r.json();
                          alert(JSON.stringify(j, null, 2));
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
                  </>
                )}

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
                  <div className="animate-in">
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
                    <input
                      type="text"
                      value={newToken}
                      onChange={(e) => {
                        setNewToken(e.target.value);
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
