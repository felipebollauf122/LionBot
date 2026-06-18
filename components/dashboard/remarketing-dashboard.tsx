"use client";

import { useState } from "react";
import {
  updateConfig,
  createRemarketingFlow,
  updateRemarketingFlow,
  deleteRemarketingFlow,
  reorderFlows,
} from "@/lib/actions/remarketing-actions";
import type { RemarketingConfig, RemarketingFlow, RemarketingAudience } from "@/lib/types/database";
import { CommandBar, KpiPill, FilterChip } from "@/components/dashboard/console/command-bar";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";

const INTERVAL_OPTIONS = [
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hora" },
];

const AUDIENCE_LABELS: Record<RemarketingAudience, string> = {
  all: "Todos os leads",
  no_purchase: "Leads sem compra",
  pending_payment: "Pix gerado, nao pagou",
};

interface Props {
  botId: string;
  config: RemarketingConfig;
  flows: RemarketingFlow[];
}

export function RemarketingDashboard({ botId, config, flows: initialFlows }: Props) {
  const [isActive, setIsActive] = useState(config.is_active);
  const [interval, setInterval] = useState(config.interval_minutes);
  const [flows, setFlows] = useState(initialFlows);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAudience, setNewAudience] = useState<RemarketingAudience>("all");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = flows.find((f) => f.id === selectedId) ?? null;
  const activeCount = flows.filter((f) => f.is_active).length;

  const handleToggle = async () => {
    const next = !isActive;
    setIsActive(next);
    await updateConfig(config.id, { is_active: next });
  };

  const handleIntervalChange = async (value: number) => {
    setInterval(value);
    setSaving(true);
    await updateConfig(config.id, { interval_minutes: value });
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const nextOrder = flows.length > 0 ? Math.max(...flows.map((f) => f.sort_order)) + 1 : 0;
      await createRemarketingFlow(botId, config.id, newName.trim(), newAudience, nextOrder);
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  const handleDelete = async (flowId: string) => {
    if (!confirm("Excluir este fluxo de remarketing?")) return;
    try {
      await deleteRemarketingFlow(flowId, botId);
    } catch {
      window.location.reload();
    }
  };

  const handleToggleFlow = async (flowId: string, active: boolean) => {
    await updateRemarketingFlow(flowId, { is_active: !active });
    setFlows((prev) =>
      prev.map((f) => (f.id === flowId ? { ...f, is_active: !active } : f))
    );
  };

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const newFlows = [...flows];
    [newFlows[index - 1], newFlows[index]] = [newFlows[index], newFlows[index - 1]];
    const orders = newFlows.map((f, i) => ({ id: f.id, sort_order: i }));
    setFlows(newFlows.map((f, i) => ({ ...f, sort_order: i })));
    await reorderFlows(orders);
  };

  const handleMoveDown = async (index: number) => {
    if (index >= flows.length - 1) return;
    const newFlows = [...flows];
    [newFlows[index], newFlows[index + 1]] = [newFlows[index + 1], newFlows[index]];
    const orders = newFlows.map((f, i) => ({ id: f.id, sort_order: i }));
    setFlows(newFlows.map((f, i) => ({ ...f, sort_order: i })));
    await reorderFlows(orders);
  };

  const handleAudienceChange = async (flowId: string, audience: RemarketingAudience) => {
    await updateRemarketingFlow(flowId, { audience });
    setFlows((prev) =>
      prev.map((f) => (f.id === flowId ? { ...f, audience } : f))
    );
  };

  const handleDeleteAfterChange = async (flowId: string, value: number | null) => {
    await updateRemarketingFlow(flowId, { delete_after_minutes: value });
    setFlows((prev) =>
      prev.map((f) => (f.id === flowId ? { ...f, delete_after_minutes: value } : f))
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Remarketing"
        subtitle="sequencia automatica"
        filters={
          <>
            <FilterChip active={isActive} onClick={handleToggle}>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: isActive ? "var(--accent)" : "var(--text-ghost)",
                  boxShadow: isActive ? "0 0 8px var(--accent-glow)" : "none",
                }}
              />
              {isActive ? "Ativo" : "Inativo"}
            </FilterChip>
            <span className="text-(--text-ghost) text-[10px] uppercase tracking-wider px-1 hidden sm:inline">
              intervalo
            </span>
            {INTERVAL_OPTIONS.map((opt) => (
              <FilterChip
                key={opt.value}
                active={interval === opt.value}
                onClick={() => handleIntervalChange(opt.value)}
              >
                {opt.label}
              </FilterChip>
            ))}
          </>
        }
        kpis={
          <>
            <KpiPill label="fluxos" value={flows.length.toLocaleString("pt-BR")} accent="amber" />
            <KpiPill label="ativos" value={activeCount.toLocaleString("pt-BR")} accent="magenta" />
          </>
        }
        action={
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo Fluxo
          </button>
        }
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6">
        {saving && (
          <p className="text-(--text-ghost) text-[10px] uppercase tracking-wider mb-3">Salvando intervalo…</p>
        )}

        {flows.length === 0 ? (
          <div className="text-center py-20 card relative max-w-3xl mx-auto">
            <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--amber)/15 to-transparent" />
            <div className="section-icon w-14 h-14 mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(255, 184, 0, 0.12) 0%, rgba(255, 184, 0, 0.04) 100%)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </div>
            <h3 className="text-foreground font-semibold mb-2 tracking-tight">Nenhum fluxo de remarketing</h3>
            <p className="text-(--text-muted) text-sm">Crie fluxos para enviar mensagens automaticamente aos seus leads</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {/* Timeline start cap */}
            <div className="flex items-center gap-3 pl-4 sm:pl-[18px]">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "var(--cyan)", boxShadow: "0 0 10px var(--cyan)" }} />
              <span className="text-(--text-ghost) text-[10px] uppercase tracking-[0.14em]">Início da sequência</span>
            </div>

            <ol className="relative">
              {flows.map((flow, index) => (
                <li key={flow.id} className="relative">
                  {/* Vertical connector line behind the node */}
                  <span
                    aria-hidden
                    className="absolute left-[23px] top-0 bottom-0 w-px"
                    style={{ background: "linear-gradient(to bottom, color-mix(in srgb, var(--amber) 28%, transparent), color-mix(in srgb, var(--amber) 12%, transparent))" }}
                  />

                  <div className="relative flex gap-4 py-3">
                    {/* Node marker + reorder */}
                    <div className="relative z-10 flex flex-col items-center shrink-0 w-12">
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        aria-label="Mover para cima"
                        className="w-5 h-5 rounded flex items-center justify-center text-(--text-muted) hover:text-foreground hover:bg-white/6 disabled:opacity-15 transition-all"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                      </button>
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold stat-value my-0.5 transition-transform group-hover:scale-105"
                        style={{
                          background: flow.is_active
                            ? "linear-gradient(135deg, rgba(255, 184, 0, 0.18) 0%, rgba(255, 184, 0, 0.05) 100%)"
                            : "rgba(255,255,255,0.04)",
                          color: flow.is_active ? "var(--amber)" : "var(--text-muted)",
                          boxShadow: flow.is_active ? "0 0 14px -4px rgba(255,184,0,0.4)" : "none",
                          border: "1px solid color-mix(in srgb, var(--amber) " + (flow.is_active ? "30%" : "0%") + ", var(--border-subtle))",
                        }}
                      >
                        {index + 1}
                      </div>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={index >= flows.length - 1}
                        aria-label="Mover para baixo"
                        className="w-5 h-5 rounded flex items-center justify-center text-(--text-muted) hover:text-foreground hover:bg-white/6 disabled:opacity-15 transition-all"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                      </button>
                    </div>

                    {/* Flow card */}
                    <div
                      onClick={() => setSelectedId(flow.id)}
                      className={`group flex-1 card p-4 relative cursor-pointer transition-all hover:border-(--amber)/25 hover:-translate-y-px ${
                        selectedId === flow.id ? "border-(--amber)/40" : ""
                      }`}
                      style={selectedId === flow.id ? { boxShadow: "0 0 0 1px color-mix(in srgb, var(--amber) 35%, transparent), 0 0 20px -8px rgba(255,184,0,0.3)" } : {}}
                    >
                      <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--amber)/10 to-transparent" />

                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-foreground font-medium text-sm tracking-tight truncate">{flow.name}</h3>
                            <span className={`toggle-btn ${flow.is_active ? "on" : "off"} text-[10px]! py-0.5! px-2! pointer-events-none`}>
                              {flow.is_active ? "Ativo" : "Inativo"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="badge badge-purple">{AUDIENCE_LABELS[flow.audience]}</span>
                            <span className="text-(--text-ghost) text-[11px]">·</span>
                            <span className="text-(--text-muted) text-[11px]"><span className="stat-value">{flow.flow_data.nodes.length}</span> nós</span>
                            {flow.delete_after_minutes != null && (
                              <>
                                <span className="text-(--text-ghost) text-[11px]">·</span>
                                <span className="text-(--text-muted) text-[11px]">deleta em <span className="stat-value">{flow.delete_after_minutes}</span>min</span>
                              </>
                            )}
                          </div>
                        </div>

                        <svg className="text-(--text-ghost) group-hover:text-(--amber) transition-colors shrink-0 mt-1" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Interval marker between nodes */}
                  {index < flows.length - 1 && (
                    <div className="relative flex items-center gap-2 pl-[54px] -my-1 z-10">
                      <span className="w-1.5 h-1.5 rounded-full -ml-[36px]" style={{ background: "color-mix(in srgb, var(--amber) 40%, transparent)" }} />
                      <span className="text-(--text-ghost) text-[10px] flex items-center gap-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        espera <span className="stat-value">{interval}</span> min
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            {/* Timeline end cap */}
            <div className="flex items-center gap-3 pl-4 sm:pl-[18px] pt-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "var(--accent)", boxShadow: "0 0 10px var(--accent-glow)" }} />
              <span className="text-(--text-ghost) text-[10px] uppercase tracking-[0.14em]">Fim da sequência</span>
            </div>
          </div>
        )}
      </div>

      {/* Create flow drawer */}
      <ContextDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Novo Fluxo"
        subtitle="criar fluxo de remarketing"
      >
        <div className="space-y-4">
          <div>
            <label className="input-label">Nome</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Lembrete 1, Oferta especial..." className="input" />
          </div>
          <div>
            <label className="input-label">Audiencia</label>
            <select value={newAudience} onChange={(e) => setNewAudience(e.target.value as RemarketingAudience)} className="input">
              <option value="all">Todos os leads</option>
              <option value="no_purchase">Leads sem compra</option>
              <option value="pending_payment">Pix gerado, nao pagou</option>
            </select>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleCreate} disabled={creating} className="btn-primary">
              {creating ? "Criando..." : "Criar Fluxo"}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </ContextDrawer>

      {/* Edit flow drawer */}
      <ContextDrawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.name || "Fluxo"}
        subtitle="editar fluxo"
        actions={
          selected && (
            <button
              onClick={() => handleToggleFlow(selected.id, selected.is_active)}
              className={`toggle-btn ${selected.is_active ? "on" : "off"}`}
            >
              {selected.is_active ? "Ativo" : "Inativo"}
            </button>
          )
        }
      >
        {selected && (
          <div className="space-y-5">
            <div>
              <label className="input-label">Audiencia</label>
              <select
                value={selected.audience}
                onChange={(e) => handleAudienceChange(selected.id, e.target.value as RemarketingAudience)}
                className="input"
              >
                <option value="all">{AUDIENCE_LABELS.all}</option>
                <option value="no_purchase">{AUDIENCE_LABELS.no_purchase}</option>
                <option value="pending_payment">{AUDIENCE_LABELS.pending_payment}</option>
              </select>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-(--text-secondary) cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={selected.delete_after_minutes != null}
                  onChange={(e) => handleDeleteAfterChange(selected.id, e.target.checked ? 60 : null)}
                  className="accent-(--amber) w-3.5 h-3.5"
                />
                Deletar mensagens automaticamente
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  disabled={selected.delete_after_minutes == null}
                  value={selected.delete_after_minutes ?? 60}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0) {
                      handleDeleteAfterChange(selected.id, n);
                    }
                  }}
                  className="w-20 bg-white/4 border border-(--border-subtle) rounded-md px-2 py-1.5 text-sm text-foreground text-center disabled:opacity-40"
                />
                <span className="text-(--text-ghost) text-xs">minutos após o envio</span>
              </div>
            </div>

            <div className="divider my-2" />

            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">Conteúdo</span>
              <span className="text-sm text-foreground"><span className="stat-value">{selected.flow_data.nodes.length}</span> nós</span>
            </div>

            <a
              href={`/dashboard/bots/${botId}/remarketing/${selected.id}/editor`}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all"
              style={{ background: "color-mix(in srgb, var(--amber) 12%, transparent)", color: "var(--amber)", border: "1px solid color-mix(in srgb, var(--amber) 22%, transparent)" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Abrir editor do fluxo
            </a>

            <div className="divider my-2" />

            <button onClick={() => handleDelete(selected.id)} className="btn-danger w-full justify-center">
              Excluir fluxo
            </button>
          </div>
        )}
      </ContextDrawer>
    </div>
  );
}
