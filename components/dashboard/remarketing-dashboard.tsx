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
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight page-title">Remarketing</h1>
          <p className="text-(--text-secondary) text-sm mt-1">Sequencia automatica de mensagens para leads</p>
        </div>
        <button
          onClick={handleToggle}
          className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all ${
            isActive
              ? "text-(--accent) border border-(--accent)/15"
              : "text-(--text-muted) border border-(--border-subtle)"
          }`}
          style={isActive
            ? { background: "linear-gradient(135deg, var(--accent-muted) 0%, rgba(255,43,214,0.04) 100%)", boxShadow: "0 0 16px -4px rgba(255,43,214,0.25)" }
            : { background: "rgba(255,255,255,0.03)" }
          }
        >
          {isActive ? "Ativo" : "Inativo"}
        </button>
      </div>

      {/* Interval config */}
      <div className="card p-4 sm:p-6 mb-6 relative">
        <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--amber)/15 to-transparent" />
        <h2 className="text-foreground font-semibold text-sm mb-4 tracking-tight">Intervalo entre fluxos</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleIntervalChange(opt.value)}
              disabled={saving}
              className={`py-3 rounded-xl text-sm font-semibold transition-all ${
                interval === opt.value
                  ? "text-white"
                  : "bg-white/3 text-(--text-muted) hover:bg-white/6 hover:text-(--text-secondary) border border-(--border-subtle)"
              }`}
              style={interval === opt.value ? { background: "linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)", boxShadow: "0 0 16px -4px var(--accent-glow)" } : {}}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-(--text-ghost) text-xs mt-3">Tempo de espera entre o envio de cada fluxo na sequencia</p>
      </div>

      {/* Flow sequence */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-foreground font-semibold text-sm tracking-tight">Sequencia de Fluxos</h2>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo Fluxo
        </button>
      </div>

      {showCreate && (
        <div className="card p-4 sm:p-6 mb-4 animate-scale relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/30 to-transparent" />
          <h3 className="text-foreground font-semibold text-sm mb-4 tracking-tight">Criar Fluxo de Remarketing</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating} className="btn-primary">
              {creating ? "Criando..." : "Criar Fluxo"}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      )}

      {flows.length === 0 ? (
        <div className="text-center py-20 card relative">
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
        <div className="space-y-2">
          {flows.map((flow, index) => (
            <div key={flow.id} className="card p-5 relative group">
              {/* Top accent */}
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--amber)/10 to-transparent" />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  {/* Reorder */}
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => handleMoveUp(index)} disabled={index === 0} className="w-5 h-5 rounded flex items-center justify-center text-(--text-muted) hover:text-foreground hover:bg-white/6 disabled:opacity-15 transition-all">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                    </button>
                    <button onClick={() => handleMoveDown(index)} disabled={index >= flows.length - 1} className="w-5 h-5 rounded flex items-center justify-center text-(--text-muted) hover:text-foreground hover:bg-white/6 disabled:opacity-15 transition-all">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                  </div>

                  {/* Order badge */}
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold stat-value" style={{ background: "linear-gradient(135deg, rgba(255, 184, 0, 0.14) 0%, rgba(255, 184, 0, 0.04) 100%)", color: "var(--amber)", boxShadow: "0 0 10px -4px rgba(255,184,0,0.2)" }}>
                    {index + 1}
                  </div>

                  <div>
                    <h3 className="text-foreground font-medium text-sm tracking-tight">{flow.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <select
                        value={flow.audience}
                        onChange={(e) => handleAudienceChange(flow.id, e.target.value as RemarketingAudience)}
                        className="bg-transparent text-(--text-muted) text-[11px] border-none p-0 focus:outline-none cursor-pointer"
                      >
                        <option value="all">{AUDIENCE_LABELS.all}</option>
                        <option value="no_purchase">{AUDIENCE_LABELS.no_purchase}</option>
                        <option value="pending_payment">{AUDIENCE_LABELS.pending_payment}</option>
                      </select>
                      <span className="text-(--text-ghost) text-[11px]">·</span>
                      <span className="text-(--text-ghost) text-[11px]"><span className="stat-value">{flow.flow_data.nodes.length}</span> nos</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <label className="flex items-center gap-1.5 text-[11px] text-(--text-muted) cursor-pointer">
                        <input
                          type="checkbox"
                          checked={flow.delete_after_minutes != null}
                          onChange={(e) =>
                            handleDeleteAfterChange(flow.id, e.target.checked ? 60 : null)
                          }
                          className="accent-(--amber) w-3 h-3"
                        />
                        Deletar apos
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        disabled={flow.delete_after_minutes == null}
                        value={flow.delete_after_minutes ?? 60}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n > 0) {
                            handleDeleteAfterChange(flow.id, n);
                          }
                        }}
                        className="w-14 bg-white/4 border border-(--border-subtle) rounded-md px-1.5 py-0.5 text-[11px] text-foreground text-center disabled:opacity-40"
                      />
                      <span className="text-(--text-ghost) text-[11px]">min</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleFlow(flow.id, flow.is_active)}
                    className={`toggle-btn ${flow.is_active ? "on" : "off"}`}
                  >
                    {flow.is_active ? "Ativo" : "Inativo"}
                  </button>
                  <a
                    href={`/dashboard/bots/${botId}/remarketing/${flow.id}/editor`}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all"
                    style={{ background: "color-mix(in srgb, var(--amber) 10%, transparent)", color: "var(--amber)" }}
                  >
                    Editar
                  </a>
                  <button onClick={() => handleDelete(flow.id)} className="btn-danger py-1.5!">
                    Excluir
                  </button>
                </div>
              </div>

              {/* Timeline connector */}
              {index < flows.length - 1 && (
                <div className="ml-[54px] mt-3 -mb-3 flex items-center gap-2 text-(--text-ghost) text-[10px]">
                  <div className="w-px h-5 bg-gradient-to-b from-(--amber)/20 to-transparent" />
                  <span className="stat-value">{interval} min</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
