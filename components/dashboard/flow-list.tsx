"use client";

import { useState } from "react";
import { createFlow, toggleFlow, deleteFlow, getOrCreateNamedFlow } from "@/lib/actions/flow-actions";
import { toggleBlackEnabled } from "@/lib/actions/bot-settings-actions";
import { exportFlow, importFlow, type ImportMode } from "@/lib/actions/flow-import-export";
import type { Flow, TriggerType } from "@/lib/types/database";

interface FlowListProps {
  flows: Flow[];
  visualFlow: Flow | null;
  blackFlow: Flow | null;
  botId: string;
  blackEnabled: boolean;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "flow";
}

async function handleExport(flow: Flow) {
  try {
    const exp = await exportFlow(flow.id);
    downloadJson(`${slugify(flow.name)}.eaglebot-flow.json`, exp);
  } catch (e) {
    alert(`Erro ao exportar: ${e instanceof Error ? e.message : "desconhecido"}`);
  }
}

function FlowCard({
  flow,
  label,
  variant,
}: {
  flow: Flow;
  label?: string;
  variant?: "visual" | "black";
}) {
  const [toggling, setToggling] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    await toggleFlow(flow.id, !flow.is_active);
    window.location.reload();
  };

  const onExport = async () => {
    setExporting(true);
    await handleExport(flow);
    setExporting(false);
  };

  const accentColor = variant === "black" ? "var(--red)" : "var(--accent)";
  const accentMuted = variant === "black" ? "var(--red-muted)" : "var(--accent-muted)";

  return (
    <div
      className="card p-5 relative group"
      style={{ borderColor: `color-mix(in srgb, ${accentColor} 12%, transparent)` }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-4 right-4 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`, opacity: 0.2 }} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          {/* Icon with glow */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center relative"
            style={{ background: `color-mix(in srgb, ${accentColor} 12%, transparent)`, boxShadow: `0 0 16px -6px ${accentColor}` }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1013 16H2m16-8a2 2 0 10-2-2H2" />
            </svg>
            {flow.is_active && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: accentColor, boxShadow: `0 0 6px 1px ${accentColor}` }} />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-foreground font-semibold text-sm tracking-tight">{label ?? flow.name}</h3>
              {variant === "black" && (
                <span className="badge badge-error text-[9px] py-0.5!">BLACK</span>
              )}
            </div>
            <p className="text-(--text-muted) text-xs mt-0.5">
              <span className="stat-value">{flow.flow_data.nodes.length}</span> nos · v{flow.version}
              <span className={`ml-2 ${flow.is_active ? "text-(--accent)" : "text-(--text-ghost)"}`}>
                {flow.is_active ? "Ativo" : "Inativo"}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`toggle-btn ${flow.is_active ? "on" : "off"}`}
          >
            {flow.is_active ? "Ativo" : "Inativo"}
          </button>
          <button
            onClick={onExport}
            disabled={exporting}
            title="Exportar fluxo"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all text-(--text-secondary) border border-(--border-subtle) hover:bg-white/4 disabled:opacity-50"
          >
            {exporting ? "..." : "Exportar"}
          </button>
          <a
            href={`/dashboard/bots/${flow.bot_id}/flows/${flow.id}/editor`}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg transition-all relative overflow-hidden"
            style={{ background: `color-mix(in srgb, ${accentColor} 10%, transparent)`, color: accentColor }}
          >
            Editar
          </a>
        </div>
      </div>
    </div>
  );
}

export function FlowList({ flows, visualFlow, blackFlow, botId, blackEnabled }: FlowListProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("command");
  const [triggerValue, setTriggerValue] = useState("/start");
  const [loading, setLoading] = useState(false);
  const [blackOn, setBlackOn] = useState(blackEnabled);
  const [togglingBlack, setTogglingBlack] = useState(false);
  const [creatingVisual, setCreatingVisual] = useState(false);
  const [creatingBlack, setCreatingBlack] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<"new" | "replace">("new");
  const [importNewName, setImportNewName] = useState("");
  const [importReplaceFlowId, setImportReplaceFlowId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const allReplaceableFlows: Array<{ id: string; label: string }> = [
    ...(visualFlow ? [{ id: visualFlow.id, label: "Fluxo Principal (_visual_flow)" }] : []),
    ...(blackFlow ? [{ id: blackFlow.id, label: "Fluxo Black (_black_flow)" }] : []),
    ...flows.map((f) => ({ id: f.id, label: f.name })),
  ];

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createFlow(botId, name, triggerType, triggerValue);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleToggle = async (flowId: string, currentState: boolean) => {
    await toggleFlow(flowId, !currentState);
    window.location.reload();
  };

  const handleDelete = async (flowId: string) => {
    if (!confirm("Tem certeza que deseja excluir este fluxo?")) return;
    await deleteFlow(flowId, botId);
  };

  const handleToggleBlack = async () => {
    setTogglingBlack(true);
    try {
      await toggleBlackEnabled(botId, !blackOn);
      setBlackOn(!blackOn);
    } catch (e) {
      console.error(e);
    } finally {
      setTogglingBlack(false);
    }
  };

  const handleImport = async () => {
    setImportError(null);
    if (!importFile) {
      setImportError("Selecione um arquivo JSON");
      return;
    }
    let payload: unknown;
    try {
      const text = await importFile.text();
      payload = JSON.parse(text);
    } catch {
      setImportError("Arquivo não é um JSON válido");
      return;
    }

    let mode: ImportMode;
    if (importMode === "new") {
      if (!importNewName.trim()) {
        setImportError("Informe um nome para o novo fluxo");
        return;
      }
      mode = { kind: "new", name: importNewName.trim() };
    } else {
      if (!importReplaceFlowId) {
        setImportError("Selecione o fluxo a substituir");
        return;
      }
      mode = { kind: "replace", flowId: importReplaceFlowId };
    }

    setImporting(true);
    try {
      const result = await importFlow(botId, payload, mode);
      window.location.href = `/dashboard/bots/${botId}/flows/${result.flowId}/editor`;
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Erro desconhecido");
      setImporting(false);
    }
  };

  const handleCreateNamedFlow = async (flowName: "_visual_flow" | "_black_flow") => {
    const setter = flowName === "_visual_flow" ? setCreatingVisual : setCreatingBlack;
    setter(true);
    try {
      const flow = await getOrCreateNamedFlow(botId, flowName);
      window.location.href = `/dashboard/bots/${botId}/flows/${flow.id}/editor`;
    } catch (e) {
      console.error(e);
      setter(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-up">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight page-title">Fluxos</h1>
          <p className="text-(--text-secondary) text-sm mt-1">Gerencie os fluxos de mensagens do seu bot</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowImport(true); setImportError(null); }}
            className="px-4 py-2 text-xs font-semibold rounded-lg transition-all text-(--text-secondary) border border-(--border-subtle) hover:bg-white/4 flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Importar
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo Fluxo
          </button>
        </div>
      </div>

      {/* ═══ VISUAL FLOW ═══ */}
      <div className="mb-6 animate-up-1">
        <div className="flex items-center gap-3 mb-3">
          <div className="section-icon w-8 h-8" style={{ background: "linear-gradient(135deg, rgba(255, 43, 214, 0.15) 0%, rgba(255, 43, 214, 0.05) 100%)" }}>
            <div className="w-2.5 h-2.5 rounded-full bg-(--accent)" style={{ boxShadow: "0 0 6px rgba(255,43,214,0.5)" }} />
          </div>
          <div>
            <h2 className="text-foreground font-semibold text-sm tracking-tight">Fluxo Principal</h2>
            <span className="text-(--text-ghost) text-[10px] font-mono stat-value">_visual_flow</span>
          </div>
        </div>
        <p className="text-(--text-muted) text-xs mb-3 ml-11">Fluxo executado quando alguem envia /start sem payload (trafego organico)</p>
        {visualFlow ? (
          <FlowCard flow={visualFlow} label="Fluxo Principal" variant="visual" />
        ) : (
          <button
            onClick={() => handleCreateNamedFlow("_visual_flow")}
            disabled={creatingVisual}
            className="w-full py-5 border border-dashed border-(--accent)/20 rounded-2xl text-(--accent) text-sm font-semibold hover:bg-(--accent-muted) hover:border-(--accent)/35 transition-all disabled:opacity-50 group"
          >
            <span className="flex items-center justify-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:rotate-90">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {creatingVisual ? "Criando..." : "Criar Fluxo Principal"}
            </span>
          </button>
        )}
      </div>

      {/* ═══ BLACK FLOW (admin only) ═══ */}
      {(blackEnabled || blackFlow) && (
      <div className="mb-8 animate-up-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="section-icon w-8 h-8" style={{ background: "linear-gradient(135deg, rgba(255, 59, 107, 0.15) 0%, rgba(255, 59, 107, 0.05) 100%)" }}>
              <div className="w-2.5 h-2.5 rounded-full bg-(--red)" style={{ boxShadow: "0 0 6px rgba(255,59,107,0.5)" }} />
            </div>
            <div>
              <h2 className="text-foreground font-semibold text-sm tracking-tight">Fluxo Black</h2>
              <span className="text-(--text-ghost) text-[10px] font-mono stat-value">_black_flow</span>
            </div>
          </div>
          <button
            onClick={handleToggleBlack}
            disabled={togglingBlack}
            className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
              blackOn
                ? "text-(--red) border border-(--red)/20"
                : "text-(--text-muted) border border-(--border-subtle) hover:bg-white/4"
            }`}
            style={blackOn ? { background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)", boxShadow: "0 0 12px -4px rgba(255,59,107,0.25)" } : { background: "rgba(255,255,255,0.03)" }}
          >
            {togglingBlack ? "..." : blackOn ? "Ativado" : "Desativado"}
          </button>
        </div>
        <p className="text-(--text-muted) text-xs mb-3 ml-11">Fluxo via /start com payload valido (trafego pago). Mensagens auto-deletadas em 15 minutos.</p>
        {blackOn ? (
          blackFlow ? (
            <FlowCard flow={blackFlow} label="Fluxo Black" variant="black" />
          ) : (
            <button
              onClick={() => handleCreateNamedFlow("_black_flow")}
              disabled={creatingBlack}
              className="w-full py-5 border border-dashed border-(--red)/20 rounded-2xl text-(--red) text-sm font-semibold hover:bg-(--red-muted) hover:border-(--red)/35 transition-all disabled:opacity-50 group"
            >
              <span className="flex items-center justify-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:rotate-90">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {creatingBlack ? "Criando..." : "Criar Fluxo Black"}
              </span>
            </button>
          )
        ) : (
          <div className="w-full py-5 border border-dashed border-(--border-subtle) rounded-2xl text-(--text-ghost) text-sm text-center">
            Ative o Flow Black para configurar
          </div>
        )}
      </div>
      )}

      {/* Separator */}
      <div className="divider mb-6" />

      {/* ═══ OTHER FLOWS ═══ */}
      <div className="flex items-center justify-between mb-4 animate-up-3">
        <h2 className="text-(--text-secondary) font-semibold text-sm tracking-tight">Outros Fluxos</h2>
      </div>

      {showImport && (
        <div className="card p-6 mb-6 animate-scale relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/30 to-transparent" />
          <h3 className="text-foreground font-semibold text-sm mb-4 tracking-tight">Importar Fluxo</h3>

          <div className="mb-4">
            <label className="input-label">Arquivo JSON</label>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="input"
            />
            <p className="text-(--text-muted) text-[11px] mt-1">
              Produtos e conjuntos do fluxo serão recriados neste bot.
            </p>
          </div>

          <div className="mb-4">
            <label className="input-label">Destino</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setImportMode("new")}
                className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
                  importMode === "new"
                    ? "bg-(--accent-muted) text-(--accent) border border-(--accent)/30"
                    : "text-(--text-secondary) border border-(--border-subtle) hover:bg-white/4"
                }`}
              >
                Criar novo fluxo
              </button>
              <button
                type="button"
                onClick={() => setImportMode("replace")}
                disabled={allReplaceableFlows.length === 0}
                className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
                  importMode === "replace"
                    ? "bg-(--accent-muted) text-(--accent) border border-(--accent)/30"
                    : "text-(--text-secondary) border border-(--border-subtle) hover:bg-white/4"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Substituir fluxo existente
              </button>
            </div>

            {importMode === "new" ? (
              <input
                type="text"
                value={importNewName}
                onChange={(e) => setImportNewName(e.target.value)}
                placeholder="Nome do novo fluxo"
                className="input"
              />
            ) : (
              <select
                value={importReplaceFlowId}
                onChange={(e) => setImportReplaceFlowId(e.target.value)}
                className="input"
              >
                <option value="">Selecione o fluxo...</option>
                {allReplaceableFlows.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            )}
          </div>

          {importError && (
            <p className="text-(--red) text-xs mb-3">{importError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing}
              className="btn-primary"
            >
              {importing ? "Importando..." : "Importar"}
            </button>
            <button
              onClick={() => { setShowImport(false); setImportFile(null); setImportError(null); }}
              disabled={importing}
              className="btn-ghost"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="card p-6 mb-6 animate-scale relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/30 to-transparent" />
          <h3 className="text-foreground font-semibold text-sm mb-4 tracking-tight">Criar Novo Fluxo</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="input-label">Nome do Fluxo</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: FAQ, Suporte" className="input" />
            </div>
            <div>
              <label className="input-label">Tipo de Gatilho</label>
              <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)} className="input">
                <option value="command">Comando</option>
                <option value="first_contact">Primeiro Contato</option>
                <option value="callback">Callback</option>
                <option value="payment_event">Evento de Pagamento</option>
              </select>
            </div>
            <div>
              <label className="input-label">Valor do Gatilho</label>
              <input type="text" value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder="/help" className="input" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={loading} className="btn-primary">
              {loading ? "Criando..." : "Criar Fluxo"}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {flows.length === 0 && !showCreate ? (
        <div className="text-center py-16">
          <p className="text-(--text-muted) text-sm">
            Nenhum fluxo adicional. Crie fluxos extras para comandos como /help, /preco, etc.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {flows.map((flow) => (
            <div
              key={flow.id}
              className="card p-4 flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-xl bg-white/4 flex items-center justify-center relative">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1013 16H2m16-8a2 2 0 10-2-2H2" />
                  </svg>
                  {flow.is_active && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-(--accent)" style={{ boxShadow: "0 0 4px rgba(255,43,214,0.5)" }} />
                  )}
                </div>
                <div>
                  <h3 className="text-foreground font-medium text-sm tracking-tight">{flow.name}</h3>
                  <p className="text-(--text-muted) text-xs mt-0.5">
                    {flow.trigger_type === "command" ? `Comando: ${flow.trigger_value}` : flow.trigger_type}
                    {" · "}<span className="stat-value">{flow.flow_data.nodes.length}</span> nos · v{flow.version}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(flow.id, flow.is_active)}
                  className={`toggle-btn ${flow.is_active ? "on" : "off"}`}
                >
                  {flow.is_active ? "Ativo" : "Inativo"}
                </button>
                <button
                  onClick={() => handleExport(flow)}
                  title="Exportar fluxo"
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all text-(--text-secondary) border border-(--border-subtle) hover:bg-white/4"
                >
                  Exportar
                </button>
                <a
                  href={`/dashboard/bots/${flow.bot_id}/flows/${flow.id}/editor`}
                  className="px-3 py-1.5 bg-(--accent-muted) text-(--accent) text-xs font-semibold rounded-lg hover:bg-(--accent)/15 transition-all"
                >
                  Editar
                </a>
                <button
                  onClick={() => handleDelete(flow.id)}
                  className="btn-danger py-1.5!"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
