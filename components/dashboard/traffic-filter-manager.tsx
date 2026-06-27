"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addRule,
  deleteRule,
  toggleRule,
  toggleTrafficFilter,
} from "@/lib/actions/traffic-filter-actions";
import type {
  TrafficFilterRule,
  TrafficFilterList,
  TrafficFilterMatchType,
} from "@/lib/types/database";

interface TrafficFilterManagerProps {
  botId: string;
  tenantId: string;
  trafficFilterEnabled: boolean;
  initialRules: TrafficFilterRule[];
}

const MATCH_TYPE_LABEL: Record<TrafficFilterMatchType, string> = {
  ip: "IP / CIDR",
  user_agent: "User-Agent",
  referer: "Referer",
  asn: "ASN",
};

const MATCH_TYPE_PLACEHOLDER: Record<TrafficFilterMatchType, string> = {
  ip: "203.0.113.0/24",
  user_agent: "facebookexternalhit",
  referer: "ads/library",
  asn: "AS15169",
};

/** Seed anti-bloqueio do crawler do FB — não deve ser removida. */
function isCrawlerSeed(rule: TrafficFilterRule): boolean {
  return !!rule.note && rule.note.toLowerCase().includes("crawler fb");
}

export function TrafficFilterManager({
  botId,
  tenantId,
  trafficFilterEnabled,
  initialRules,
}: TrafficFilterManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(trafficFilterEnabled);
  const [togglingMaster, setTogglingMaster] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);

  // Add form
  const [list, setList] = useState<TrafficFilterList>("block");
  const [matchType, setMatchType] = useState<TrafficFilterMatchType>("ip");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Per-row pending state
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const allowRules = initialRules.filter((r) => r.list === "allow");
  const blockRules = initialRules.filter((r) => r.list === "block");

  const handleToggleMaster = () => {
    setMasterError(null);
    setTogglingMaster(true);
    const next = !enabled;
    setEnabled(next); // optimistic
    startTransition(async () => {
      try {
        await toggleTrafficFilter(botId, next);
        router.refresh();
      } catch (e) {
        setEnabled(!next); // revert
        setMasterError(e instanceof Error ? e.message : "Erro ao alterar");
      } finally {
        setTogglingMaster(false);
      }
    });
  };

  const handleAdd = () => {
    if (!value.trim()) {
      setAddError("Valor da regra nao pode ser vazio");
      return;
    }
    setAddError(null);
    startTransition(async () => {
      try {
        await addRule({
          tenantId,
          list,
          matchType,
          value: value.trim(),
          note: note.trim() || undefined,
        });
        setValue("");
        setNote("");
        router.refresh();
      } catch (e) {
        setAddError(e instanceof Error ? e.message : "Erro ao adicionar");
      }
    });
  };

  const handleToggleRule = (rule: TrafficFilterRule) => {
    setRowBusy(rule.id);
    startTransition(async () => {
      try {
        await toggleRule(rule.id, !rule.is_active);
        router.refresh();
      } catch (e) {
        console.error(e);
      } finally {
        setRowBusy(null);
      }
    });
  };

  const handleDelete = (rule: TrafficFilterRule) => {
    setRowBusy(rule.id);
    startTransition(async () => {
      try {
        await deleteRule(rule.id);
        router.refresh();
      } catch (e) {
        console.error(e);
      } finally {
        setRowBusy(null);
      }
    });
  };

  const renderRule = (rule: TrafficFilterRule) => {
    const seed = isCrawlerSeed(rule);
    const accent = rule.list === "allow" ? "var(--cyan)" : "var(--red)";
    const busy = rowBusy === rule.id;
    return (
      <div
        key={rule.id}
        className="flex items-center justify-between gap-3 p-3 rounded-xl border border-(--border-subtle) group hover:bg-white/2 transition-colors"
        style={
          seed
            ? { background: "color-mix(in srgb, var(--amber) 7%, transparent)", borderColor: "color-mix(in srgb, var(--amber) 30%, transparent)" }
            : undefined
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="shrink-0 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider"
            style={{
              color: accent,
              background: `color-mix(in srgb, ${accent} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${accent} 25%, transparent)`,
            }}
          >
            {MATCH_TYPE_LABEL[rule.match_type]}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-foreground text-sm font-mono truncate ${rule.is_active ? "" : "opacity-40 line-through"}`}>
                {rule.value}
              </span>
              {seed && (
                <span className="shrink-0 text-(--amber) text-[10px] font-bold whitespace-nowrap">
                  Anti-bloqueio — nao remover
                </span>
              )}
            </div>
            {rule.note && (
              <span className="text-(--text-ghost) text-xs truncate block">{rule.note}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* active/inactive switch */}
          <button
            type="button"
            role="switch"
            aria-checked={rule.is_active}
            title={rule.is_active ? "Ativa" : "Inativa"}
            disabled={busy || isPending}
            onClick={() => handleToggleRule(rule)}
            className={`relative shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${rule.is_active ? "bg-(--cyan)" : "bg-white/10"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${rule.is_active ? "translate-x-4" : ""}`} />
          </button>

          {!seed && (
            <button
              onClick={() => handleDelete(rule)}
              disabled={busy || isPending}
              className="px-3 py-1.5 text-xs font-bold text-(--red) border border-(--red)/15 rounded-lg hover:bg-(--red-muted) transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50 shrink-0"
              style={{ background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)" }}
            >
              {busy ? "..." : "Remover"}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (
    title: string,
    subtitle: string,
    accent: string,
    rules: TrafficFilterRule[],
  ) => (
    <div className="card p-6 relative">
      <div className="absolute top-0 left-4 right-4 h-px" style={{ background: `linear-gradient(to right, transparent, color-mix(in srgb, ${accent} 30%, transparent), transparent)` }} />
      <div className="flex items-center gap-3 mb-4">
        <div
          className="section-icon w-9 h-9"
          style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, boxShadow: `0 0 12px -4px ${accent}` }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div>
          <h3 className="text-foreground font-semibold text-sm tracking-tight">{title}</h3>
          <p className="text-(--text-muted) text-xs">{subtitle}</p>
        </div>
        <span className="ml-auto text-(--text-ghost) text-xs font-mono">{rules.length}</span>
      </div>
      {rules.length === 0 ? (
        <p className="text-(--text-ghost) text-xs text-center py-4">Nenhuma regra</p>
      ) : (
        <div className="space-y-2">{rules.map(renderRule)}</div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Master toggle */}
      <div className="card p-6 relative">
        <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--red)/15 to-transparent" />
        <div className="flex items-start gap-4">
          <div
            className="section-icon w-10 h-10 shrink-0"
            style={{ background: "color-mix(in srgb, var(--red) 14%, transparent)", boxShadow: "0 0 12px -4px var(--red)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-foreground font-semibold text-sm tracking-tight">Filtro de trafego</h2>
            <p className="text-(--text-muted) text-xs mt-0.5 leading-relaxed max-w-xl">
              Filtra os visitantes da pagina de clique <span className="font-mono">/t</span>. Visitantes suspeitos (espiao
              sem fbclid, vindo da Ad Library, datacenter/VPN) caem numa landing de venda do LionBot em vez de ver a
              oferta do bot. O crawler do Facebook e cliques reais sempre veem a pagina normal.
            </p>
            <p className="text-(--text-ghost) text-xs mt-2">
              {enabled
                ? "Ativo — o filtro esta rodando na /t deste bot."
                : "Desligado — o filtro NAO roda; todos veem a oferta normal."}
            </p>
            {masterError && <p className="text-(--red) text-xs mt-2">{masterError}</p>}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={togglingMaster}
            onClick={handleToggleMaster}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${enabled ? "bg-(--cyan)" : "bg-white/10"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </div>

      {/* Add form */}
      <div className="card p-6 relative">
        <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/15 to-transparent" />
        <h3 className="text-foreground font-semibold text-sm tracking-tight mb-4">Adicionar regra</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="input-label">Lista</label>
            <select
              value={list}
              onChange={(e) => setList(e.target.value as TrafficFilterList)}
              className="input"
            >
              <option value="allow">Permitidos (allow)</option>
              <option value="block">Bloqueados (block)</option>
            </select>
          </div>
          <div>
            <label className="input-label">Tipo</label>
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as TrafficFilterMatchType)}
              className="input"
            >
              <option value="ip">IP / CIDR</option>
              <option value="user_agent">User-Agent</option>
              <option value="referer">Referer</option>
              <option value="asn">ASN</option>
            </select>
          </div>
          <div>
            <label className="input-label">Valor *</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={MATCH_TYPE_PLACEHOLDER[matchType]}
              className="input"
            />
          </div>
          <div>
            <label className="input-label">Nota</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
              className="input"
            />
          </div>
        </div>
        {addError && <p className="text-(--red) text-xs mb-2">{addError}</p>}
        <button
          onClick={handleAdd}
          disabled={isPending}
          className="btn-primary py-2! px-4! text-xs!"
        >
          {isPending ? "Adicionando..." : "+ Adicionar regra"}
        </button>
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {renderSection(
          "Permitidos (allow)",
          "Sempre veem a pagina real — vence o block",
          "var(--cyan)",
          allowRules,
        )}
        {renderSection(
          "Bloqueados (block)",
          "Caem na landing de venda do LionBot",
          "var(--red)",
          blockRules,
        )}
      </div>
    </div>
  );
}
