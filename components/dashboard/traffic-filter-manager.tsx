"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addRule,
  deleteRule,
  moveRule,
  toggleRule,
  toggleTrafficFilter,
  setTrafficCategory,
  type TrafficCategoryKey,
} from "@/lib/actions/traffic-filter-actions";
import { SlugGateManager } from "@/components/dashboard/slug-gate-manager";
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
  /** categorias liga/desliga (colunas tf_block_* do bot) */
  categories?: {
    tf_block_spies: boolean;
    tf_block_datacenter: boolean;
    tf_block_adlibrary: boolean;
    tf_block_fb_crawler: boolean;
  };
  /** chave secreta (slug) — proteção final */
  slugGate?: {
    enabled: boolean;
    slugPlain: string | null;
  };
}

/** As 3 categorias amigáveis (botões liga/desliga em português). */
const CATEGORY_DEFS: { key: TrafficCategoryKey; title: string; desc: string }[] = [
  {
    key: "tf_block_spies",
    title: "Bloquear espiões (sem clique no anúncio)",
    desc: "Quem abre o link sem ter clicado no seu anúncio cai na página de venda. Recomendado ligado.",
  },
  {
    key: "tf_block_datacenter",
    title: "Bloquear VPN e datacenter",
    desc: "Acessos de servidores, VPNs e proxies (típico de robôs e concorrentes espiando).",
  },
  {
    key: "tf_block_adlibrary",
    title: "Bloquear quem vem da Biblioteca de Anúncios",
    desc: "Quem chega pela Ad Library do Facebook (gente bisbilhotando seus anúncios).",
  },
];

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

/** Regra do crawler revisor do FB. Vem na allowlist por padrão; pode ser movida
 *  pra blocklist (com aviso), mas não pode ser removida. */
function isCrawlerRule(rule: TrafficFilterRule): boolean {
  return rule.rule_kind === "fb_crawler";
}

export function TrafficFilterManager({
  botId,
  tenantId,
  trafficFilterEnabled,
  initialRules,
  categories,
  slugGate,
}: TrafficFilterManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(trafficFilterEnabled);
  const [togglingMaster, setTogglingMaster] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);

  // Categorias amigáveis (liga/desliga). As 3 de bloqueio começam ligadas;
  // o crawler do FB começa DESLIGADO (permitido) por padrão.
  const [cats, setCats] = useState({
    tf_block_spies: categories?.tf_block_spies ?? true,
    tf_block_datacenter: categories?.tf_block_datacenter ?? true,
    tf_block_adlibrary: categories?.tf_block_adlibrary ?? true,
    tf_block_fb_crawler: categories?.tf_block_fb_crawler ?? false,
  });
  const [catBusy, setCatBusy] = useState<TrafficCategoryKey | null>(null);

  // Mostrar/esconder o formulário avançado de regra manual (IP/ASN na mão).
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Add form
  const [list, setList] = useState<TrafficFilterList>("block");
  const [matchType, setMatchType] = useState<TrafficFilterMatchType>("ip");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Per-row pending state
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // Modal de confirmação ao bloquear o crawler do FB (substitui o window.confirm).
  const [showCrawlerModal, setShowCrawlerModal] = useState(false);

  const allowRules = initialRules.filter((r) => r.list === "allow");
  const blockRules = initialRules.filter((r) => r.list === "block");

  // Crawler do FB: agora é uma categoria como as outras (flag tf_block_fb_crawler).
  const crawlerBlocked = cats.tf_block_fb_crawler;

  const handleCategory = (key: TrafficCategoryKey, next: boolean) => {
    setCats((c) => ({ ...c, [key]: next })); // optimistic
    setCatBusy(key);
    startTransition(async () => {
      try {
        await setTrafficCategory(botId, key, next);
        router.refresh();
      } catch (e) {
        setCats((c) => ({ ...c, [key]: !next })); // revert
        console.error(e);
      } finally {
        setCatBusy(null);
      }
    });
  };

  // Ligar a chave do crawler = bloquear o robô do FB = cloaking. Abre o modal
  // de confirmação ao LIGAR; desligar é seguro e aplica direto.
  const handleCrawlerToggle = () => {
    if (!crawlerBlocked) {
      setShowCrawlerModal(true); // vai bloquear → confirma no modal
    } else {
      handleCategory("tf_block_fb_crawler", false); // desbloquear é seguro
    }
  };

  const confirmCrawlerBlock = () => {
    setShowCrawlerModal(false);
    handleCategory("tf_block_fb_crawler", true);
  };

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

  const handleMove = (rule: TrafficFilterRule) => {
    const target: TrafficFilterList = rule.list === "allow" ? "block" : "allow";

    // Mover o crawler revisor do FB pra BLOCK = cloaking (ele cai na landing de
    // venda em vez da /t real) → anúncio reprovado / conta banida. Confirma forte.
    if (isCrawlerRule(rule) && target === "block") {
      const ok = window.confirm(
        "ATENÇÃO — risco de banimento.\n\n" +
        "Mover o crawler do Facebook para os BLOQUEADOS faz o robô revisor da Meta " +
        "cair na landing de venda do LionBot em vez da página real. Isso é CLOAKING: " +
        "o Facebook vê conteúdo diferente do usuário, REPROVA o anúncio e pode BANIR a conta.\n\n" +
        "Isso NÃO protege a sua oferta — sem anúncio aprovado não há tráfego nenhum.\n\n" +
        "Tem certeza de que quer mover mesmo assim?"
      );
      if (!ok) return;
    }

    setRowBusy(rule.id);
    startTransition(async () => {
      try {
        await moveRule(rule.id, target);
        router.refresh();
      } catch (e) {
        console.error(e);
      } finally {
        setRowBusy(null);
      }
    });
  };

  const renderRule = (rule: TrafficFilterRule) => {
    const crawler = isCrawlerRule(rule);
    // Crawler na blocklist = cloaking ativo → destaca em vermelho/alerta.
    const danger = crawler && rule.list === "block";
    const accent = rule.list === "allow" ? "var(--cyan)" : "var(--red)";
    const busy = rowBusy === rule.id;
    const moveLabel = rule.list === "allow" ? "→ Bloquear" : "→ Permitir";
    return (
      <div
        key={rule.id}
        className="flex items-center justify-between gap-3 p-3 rounded-xl border border-(--border-subtle) group hover:bg-white/2 transition-colors"
        style={
          danger
            ? { background: "color-mix(in srgb, var(--red) 9%, transparent)", borderColor: "color-mix(in srgb, var(--red) 40%, transparent)" }
            : crawler
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
              {crawler && !danger && (
                <span className="shrink-0 text-(--amber) text-[10px] font-bold whitespace-nowrap">
                  Crawler do Facebook · recomendado em Permitidos
                </span>
              )}
              {danger && (
                <span className="shrink-0 text-(--red) text-[10px] font-bold whitespace-nowrap">
                  ⚠ Cloaking — risco de banimento
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

          {/* mover entre listas (allow ↔ block) */}
          <button
            onClick={() => handleMove(rule)}
            disabled={busy || isPending}
            title={rule.list === "allow" ? "Mover para Bloqueados" : "Mover para Permitidos"}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50 shrink-0"
            style={{
              color: rule.list === "allow" ? "var(--red)" : "var(--cyan)",
              borderColor: `color-mix(in srgb, ${rule.list === "allow" ? "var(--red)" : "var(--cyan)"} 18%, transparent)`,
              background: "rgba(255,255,255,0.02)",
            }}
          >
            {busy ? "..." : moveLabel}
          </button>

          {!crawler && (
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

      {/* Categorias amigáveis (liga/desliga) — só aparecem com o filtro ligado */}
      {enabled && (
        <div className="card p-6 relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/15 to-transparent" />
          <h3 className="text-foreground font-semibold text-sm tracking-tight">O que bloquear</h3>
          <p className="text-(--text-muted) text-xs mt-0.5 mb-4">
            Quem clica no seu anúncio de verdade sempre passa. Estas chaves decidem quem mais é barrado.
          </p>

          <div className="space-y-2">
            {CATEGORY_DEFS.map((c) => {
              const on = cats[c.key];
              const busy = catBusy === c.key;
              return (
                <div key={c.key} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-(--border-subtle)">
                  <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium">{c.title}</p>
                    <p className="text-(--text-muted) text-xs mt-0.5">{c.desc}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    disabled={busy || isPending}
                    onClick={() => handleCategory(c.key, !on)}
                    className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-(--cyan)" : "bg-white/10"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`} />
                  </button>
                </div>
              );
            })}

            {/* Crawler do Facebook — 4ª chave, igual às outras. Os 3 user-agents
                (facebookexternalhit/facebookcatalog/meta-externalagent) são uma
                classe só. Desligado (permitido) por padrão; aviso de cloaking. */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-(--border-subtle)">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">Bloquear o robô revisor do Facebook</p>
                <p className="text-(--text-muted) text-xs mt-0.5">
                  {crawlerBlocked
                    ? "⚠ Bloqueado — isto é cloaking; o Facebook pode reprovar o anúncio e banir a conta."
                    : "⚠ Cuidado: bloquear o revisor do FB é cloaking e pode reprovar seu anúncio. Deixe desligado salvo se souber o que faz."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={crawlerBlocked}
                disabled={catBusy === "tf_block_fb_crawler" || isPending}
                onClick={handleCrawlerToggle}
                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${crawlerBlocked ? "bg-(--red)" : "bg-white/10"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${crawlerBlocked ? "translate-x-5" : ""}`} />
              </button>
            </div>
          </div>

          {/* Avançado: regras manuais por IP/ASN (escondido por padrão) */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mt-4 text-(--text-ghost) text-xs hover:text-(--text-muted) transition-colors"
          >
            {showAdvanced ? "▾ Esconder regras avançadas" : "▸ Regras avançadas (IP, ASN, User-Agent)"}
          </button>

          {showAdvanced && (
            <div className="mt-3 pt-4 border-t border-(--border-subtle)">
              <p className="text-(--text-muted) text-xs mb-3">
                Para casos específicos: bloquear ou liberar um IP, faixa (CIDR), ASN, User-Agent ou referer manualmente.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="input-label">Lista</label>
                  <select value={list} onChange={(e) => setList(e.target.value as TrafficFilterList)} className="input">
                    <option value="allow">Permitidos (allow)</option>
                    <option value="block">Bloqueados (block)</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Tipo</label>
                  <select value={matchType} onChange={(e) => setMatchType(e.target.value as TrafficFilterMatchType)} className="input">
                    <option value="ip">IP / CIDR</option>
                    <option value="user_agent">User-Agent</option>
                    <option value="referer">Referer</option>
                    <option value="asn">ASN</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Valor *</label>
                  <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={MATCH_TYPE_PLACEHOLDER[matchType]} className="input" />
                </div>
                <div>
                  <label className="input-label">Nota</label>
                  <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" className="input" />
                </div>
              </div>
              {addError && <p className="text-(--red) text-xs mb-2">{addError}</p>}
              <button onClick={handleAdd} disabled={isPending} className="btn-primary py-2! px-4! text-xs!">
                {isPending ? "Adicionando..." : "+ Adicionar regra"}
              </button>

              {/* Listas das regras manuais */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
                {renderSection("Permitidos (allow)", "Sempre veem a pagina real — vence o block", "var(--cyan)", allowRules)}
                {renderSection("Bloqueados (block)", "Caem na landing de venda do LionBot", "var(--red)", blockRules)}
              </div>
            </div>
          )}

          {/* Chave secreta (slug) — proteção final */}
          {slugGate && (
            <SlugGateManager
              botId={botId}
              slugGateEnabled={slugGate.enabled}
              slugPlain={slugGate.slugPlain}
            />
          )}
        </div>
      )}

      {/* ── Modal: confirmar bloqueio do crawler do FB (cloaking) ───────────── */}
      {showCrawlerModal && (
        <div
          className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="crawler-modal-title"
          onClick={() => setShowCrawlerModal(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-(--red)/25 overflow-hidden animate-in zoom-in-95 duration-200"
            style={{
              background: "linear-gradient(160deg, #1a0815 0%, #12060f 100%)",
              boxShadow: "0 24px 80px -20px rgba(255,43,107,0.5), 0 0 0 1px rgba(255,43,107,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* glow superior */}
            <div className="absolute top-0 left-6 right-6 h-px" style={{ background: "linear-gradient(to right, transparent, var(--red), transparent)" }} />

            <div className="p-6">
              {/* Ícone de alerta */}
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "color-mix(in srgb, var(--red) 16%, transparent)", boxShadow: "0 0 24px -6px var(--red)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>

              <h2 id="crawler-modal-title" className="text-foreground font-bold text-lg tracking-tight">
                Bloquear o robô do Facebook?
              </h2>
              <p className="text-(--red) text-xs font-bold uppercase tracking-wider mt-1">
                Risco de banimento
              </p>

              <div className="mt-4 space-y-3 text-sm leading-relaxed text-(--text-secondary)">
                <p>
                  O robô revisor da Meta vai cair na <b className="text-foreground">página de venda</b> em vez da página
                  real do seu bot.
                </p>
                <div
                  className="rounded-xl p-3 border border-(--red)/20"
                  style={{ background: "color-mix(in srgb, var(--red) 8%, transparent)" }}
                >
                  <p className="text-(--text-muted) text-xs">
                    Isso é <b className="text-(--red)">cloaking</b>: o Facebook vê uma página diferente da que o usuário vê.
                    O resultado é o anúncio <b className="text-foreground">reprovado</b> e a conta sob risco de
                    <b className="text-foreground"> banimento</b>.
                  </p>
                </div>
                <p className="text-(--text-muted) text-xs">
                  Isto <b className="text-foreground">não protege a sua oferta</b> — sem anúncio aprovado, não há tráfego
                  nenhum chegando ao bot.
                </p>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCrawlerModal(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-foreground border border-(--border-default) hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmCrawlerBlock}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
                  style={{
                    background: "linear-gradient(135deg, var(--red) 0%, #c01e4a 100%)",
                    boxShadow: "0 8px 24px -8px rgba(255,43,107,0.7)",
                  }}
                >
                  Bloquear mesmo assim
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
