"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSlugForBot, toggleSlugGate } from "@/lib/actions/traffic-filter-actions";

interface SlugGateManagerProps {
  botId: string;
  slugGateEnabled: boolean;
  slugPlain: string | null;
}

export function SlugGateManager({ botId, slugGateEnabled, slugPlain }: SlugGateManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(slugGateEnabled);
  const [slug, setSlug] = useState(slugPlain);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await generateSlugForBot(botId);
        setSlug(res.slug);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao gerar slug");
      }
    });
  };

  const handleToggle = () => {
    const next = !enabled;
    setError(null);
    setEnabled(next); // optimistic
    startTransition(async () => {
      try {
        await toggleSlugGate(botId, next);
        router.refresh();
      } catch (e) {
        setEnabled(!next); // revert
        setError(e instanceof Error ? e.message : "Erro ao alterar");
      }
    });
  };

  const copySlug = () => {
    if (!slug) return;
    navigator.clipboard.writeText(slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="pt-4 border-t border-(--border-subtle)">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="section-icon w-8 h-8 shrink-0"
          style={{ background: "color-mix(in srgb, var(--purple) 14%, transparent)", boxShadow: "0 0 12px -4px var(--purple)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground font-semibold text-sm tracking-tight">Chave secreta (slug)</h3>
          <p className="text-(--text-muted) text-xs mt-0.5 leading-relaxed">
            Proteção final. Quando ativa, só acessa o bot quem trouxer o slug certo no link
            (<span className="font-mono">&amp;s=…</span>). Use esse link no seu anúncio. Quem não tem o slug cai na página de venda.
          </p>
        </div>
      </div>

      {/* Slug atual */}
      {slug ? (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0 bg-white/3 border border-(--border-subtle) rounded-lg px-3 py-2 text-xs font-mono text-foreground truncate">
            {slug}
          </div>
          <button
            type="button"
            onClick={copySlug}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-white/4 text-(--text-secondary) border border-(--border-subtle) hover:bg-white/8 hover:text-foreground transition-all"
          >
            {copied ? "Copiado!" : "Copiar slug"}
          </button>
        </div>
      ) : (
        <p className="text-(--text-ghost) text-xs mb-3">Nenhum slug gerado ainda.</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          className="px-3 py-2 rounded-lg text-xs font-bold text-(--purple) border border-(--purple)/20 hover:bg-(--purple)/8 transition-all disabled:opacity-50"
        >
          {isPending ? "..." : slug ? "Gerar novo slug" : "Gerar slug"}
        </button>

        {/* Toggle ativar */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-(--text-muted) text-xs">{enabled ? "Ativo" : "Desligado"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={isPending || !slug}
            title={!slug ? "Gere um slug primeiro" : enabled ? "Desativar" : "Ativar"}
            onClick={handleToggle}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${enabled ? "bg-(--purple)" : "bg-white/10"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </div>

      {enabled && (
        <p className="text-(--purple) text-xs mt-3">
          Ativo — só acessa o bot quem trouxer <span className="font-mono">&amp;s={slug}</span> no link. Confira que seu anúncio usa esse link.
        </p>
      )}
      {error && <p className="text-(--red) text-xs mt-2">{error}</p>}
    </div>
  );
}
