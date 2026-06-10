"use client";

import { useState } from "react";
import { LionMark } from "@/components/brand/lion-mark";
import type { Bot } from "@/lib/types/database";

interface BotCardProps {
  bot: Bot;
}

export function BotCard({ bot }: BotCardProps) {
  const [copied, setCopied] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const trackingUrl = bot.utmify_api_key
    ? `bot=${bot.id}&utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}`
    : `${baseUrl}/t?bot=${bot.id}`;

  function handleCopyTracking(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(trackingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const hasTracking = !!bot.facebook_pixel_id;
  const hasPayment = !!bot.sigilopay_public_key;

  return (
    <a
      href={`/dashboard/bots/${bot.id}/flows`}
      className="card group block p-5 relative"
    >
      {/* Top accent line on hover */}
      <div className="absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-(--accent) to-transparent opacity-0 group-hover:opacity-40 transition-opacity duration-300" />

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center transition-all relative">
            {bot.avatar_url ? (
              <img src={bot.avatar_url} alt="" className="w-10 h-10 rounded-xl object-cover" />
            ) : (
              <LionMark size={38} glow={false} />
            )}
            {bot.is_active && (
              <div className="absolute -inset-0.5 rounded-xl border border-(--cyan)/15" style={{ animation: "pulse-ring 3s ease-in-out infinite" }} />
            )}
          </div>
          <div>
            <h3 className="text-foreground font-semibold text-sm group-hover:text-(--accent-hover) transition-colors tracking-tight">
              @{bot.bot_username}
            </h3>
            <span className="text-(--text-ghost) text-[10px] font-mono stat-value">
              {bot.id.slice(0, 8)}...
            </span>
          </div>
        </div>
        <span className={`badge ${bot.is_active ? "badge-active" : "badge-inactive"}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${bot.is_active ? "bg-(--accent)" : "bg-(--text-ghost)"}`} />
          {bot.is_active ? "Ativo" : "Inativo"}
        </span>
      </div>

      {/* Status indicators */}
      <div className="flex gap-4 mb-5">
        <div className="flex items-center gap-2">
          <div className={`status-dot ${hasTracking ? "active" : "inactive"}`} />
          <span className="text-(--text-muted) text-[11px] font-medium">Tracking</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`status-dot ${hasPayment ? "active" : "inactive"}`} />
          <span className="text-(--text-muted) text-[11px] font-medium">Pagamento</span>
        </div>
      </div>

      {/* Tracking URL */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 bg-white/3 border border-(--border-subtle) rounded-lg px-3 py-2 text-[11px] text-(--text-muted) font-mono truncate" style={{ boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)" }}>
          /t?bot={bot.id.slice(0, 12)}...
        </div>
        <button
          onClick={handleCopyTracking}
          className={`shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all ${
            copied
              ? "bg-(--accent-muted) text-(--accent) border border-(--accent)/20"
              : "bg-white/4 text-(--text-secondary) border border-(--border-subtle) hover:bg-white/8 hover:text-foreground hover:border-(--border-default)"
          }`}
          style={copied ? { boxShadow: "0 0 12px -4px rgba(255,43,214,0.3)" } : {}}
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>

      {/* Background glow on hover */}
      <div className="absolute bottom-0 left-[15%] right-[15%] h-20 bg-(--accent) opacity-0 group-hover:opacity-[0.04] blur-[30px] transition-opacity duration-500 pointer-events-none" />
    </a>
  );
}
