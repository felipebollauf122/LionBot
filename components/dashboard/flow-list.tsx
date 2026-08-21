"use client";

import { useMemo, useState } from "react";
import { createFlow, toggleFlow, deleteFlow, getOrCreateNamedFlow } from "@/lib/actions/flow-actions";
import { toggleBlackEnabled } from "@/lib/actions/bot-settings-actions";
import { exportFlow, importFlow, type ImportMode } from "@/lib/actions/flow-import-export";
import type { Flow, TriggerType } from "@/lib/types/database";
import { CommandBar, CommandSearch, KpiPill } from "@/components/dashboard/console/command-bar";
import { DataGrid, RowGroupHeader, type Column } from "@/components/dashboard/console/data-grid";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";

interface FlowListProps {
  flows: Flow[];
  visualFlow: Flow | null;
  blackFlow: Flow | null;
  botId: string;
  blackEnabled: boolean;
  /** Prefixo de navegação — default `/dashboard/bots/{botId}` (mesmo padrão
   * de BotShell/BotSidebar). A view admin passa
   * `/dashboard/admin/users/{userId}/bots/{botId}` pra "Abrir editor" manter
   * o admin dentro do namespace admin em vez de cair no dashboard normal do
   * usuário impersonado. */
  basePath?: string;
}

type GroupKind = "principal" | "black" | "outros";

/** A flow plus its display group + the label/variant overrides for named flows. */
interface FlowRow {
  flow: Flow;
  group: GroupKind;
  label: string;
  variant: "visual" | "black" | "plain";
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

const TRIGGER_TYPE_LABEL: Record<TriggerType, string> = {
  command: "Comando",
  first_contact: "Primeiro Contato",
  callback: "Callback",
  payment_event: "Evento de Pagamento",
};

/** Display string for a trigger: the command for `command`, otherwise the type name. */
function triggerLabel(flow: Flow): string {
  return flow.trigger_type === "command" ? flow.trigger_value : TRIGGER_TYPE_LABEL[flow.trigger_type];
}

const VARIANT_ACCENT = {
  visual: { color: "var(--accent)" },
  black: { color: "var(--red)" },
  plain: { color: "var(--text-secondary)" },
} as const;

/** The flow "S" icon used everywhere. */
function FlowGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.59 4.59A2 2 0 1111 8H2m10.59 11.41A2 2 0 1013 16H2m16-8a2 2 0 10-2-2H2" />
    </svg>
  );
}

export function FlowList({ flows, visualFlow, blackFlow, botId, blackEnabled, basePath }: FlowListProps) {
  const base = basePath ?? `/dashboard/bots/${botId}`;
  // ── creation / import drawer state ─────────────────────────────────────────
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

  // ── row detail drawer state ────────────────────────────────────────────────
  const [selected, setSelected] = useState<FlowRow | null>(null);
  const [search, setSearch] = useState("");
  const [rowBusy, setRowBusy] = useState(false);

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

  // ── build the grouped row model (preserves type-based grouping) ─────────────
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (f: Flow, label: string) =>
      !q || label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q) || triggerLabel(f).toLowerCase().includes(q);

    const principal: FlowRow[] = [];
    if (visualFlow && matches(visualFlow, "Fluxo Principal")) {
      principal.push({ flow: visualFlow, group: "principal", label: "Fluxo Principal", variant: "visual" });
    }

    const black: FlowRow[] = [];
    if (blackOn && blackFlow && matches(blackFlow, "Fluxo Black")) {
      black.push({ flow: blackFlow, group: "black", label: "Fluxo Black", variant: "black" });
    }

    const outros: FlowRow[] = flows
      .filter((f) => matches(f, f.name))
      .map((f) => ({ flow: f, group: "outros" as const, label: f.name, variant: "plain" as const }));

    return { principal, black, outros };
  }, [flows, visualFlow, blackFlow, blackOn, search]);

  const activeCount =
    (visualFlow?.is_active ? 1 : 0) +
    (blackFlow?.is_active && blackOn ? 1 : 0) +
    flows.filter((f) => f.is_active).length;
  const totalCount = (visualFlow ? 1 : 0) + (blackFlow && blackOn ? 1 : 0) + flows.length;

  // ── shared column set ──────────────────────────────────────────────────────
  const columns: Column<FlowRow>[] = [
    {
      key: "name",
      header: "Nome",
      cell: (r) => {
        const c = VARIANT_ACCENT[r.variant].color;
        return (
          <div className="flex items-center gap-2.5">
            <span
              className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center relative"
              style={{ background: `color-mix(in srgb, ${c} 12%, transparent)`, boxShadow: r.flow.is_active ? `0 0 14px -6px ${c}` : undefined }}
            >
              <FlowGlyph color={c} />
              {r.flow.is_active && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-foreground font-medium truncate">{r.label}</p>
                {r.variant === "black" && <span className="badge badge-error text-[9px] py-0.5!">BLACK</span>}
              </div>
              {r.variant !== "plain" && (
                <p className="text-[10px] text-(--text-ghost) font-mono stat-value">
                  {r.variant === "visual" ? "_visual_flow" : "_black_flow"}
                </p>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "trigger",
      header: "Trigger",
      secondary: true,
      cell: (r) =>
        r.flow.trigger_type === "command" ? (
          <span className="text-(--text-muted) text-xs font-mono stat-value">{r.flow.trigger_value}</span>
        ) : (
          <span className="badge badge-purple">{triggerLabel(r.flow)}</span>
        ),
    },
    {
      key: "nodes",
      header: "Nós",
      align: "right",
      secondary: true,
      cell: (r) => <span className="text-(--text-secondary) text-xs stat-value num-pop">{r.flow.flow_data.nodes.length}</span>,
    },
    {
      key: "version",
      header: "Versão",
      align: "right",
      secondary: true,
      cell: (r) => <span className="text-(--text-muted) text-xs stat-value">v{r.flow.version}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      cell: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggle(r.flow.id, r.flow.is_active);
          }}
          className={`toggle-btn ${r.flow.is_active ? "on" : "off"}`}
        >
          {r.flow.is_active ? "Ativo" : "Inativo"}
        </button>
      ),
    },
  ];

  const showBlackSection = blackEnabled || blackFlow;

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Fluxos"
        subtitle="fluxos de mensagens"
        search={<CommandSearch value={search} onChange={setSearch} placeholder="Buscar por nome ou trigger..." />}
        kpis={
          <>
            <KpiPill label="total" value={totalCount.toLocaleString("pt-BR")} accent="magenta" />
            <KpiPill label="ativos" value={activeCount.toLocaleString("pt-BR")} accent="cyan" />
          </>
        }
        action={
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
        }
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6 max-w-5xl w-full mx-auto">
        {/* ═══ PRINCIPAL ═══ */}
        <RowGroupHeader label="Principal" count={groups.principal.length} accent="magenta" />
        <p className="text-(--text-muted) text-xs mb-2 px-3">
          Executado quando alguém envia /start sem payload (tráfego orgânico).
        </p>
        {groups.principal.length > 0 ? (
          <div className="card overflow-x-auto">
            <DataGrid
              columns={columns}
              rows={groups.principal}
              rowKey={(r) => r.flow.id}
              onRowClick={(r) => setSelected(r)}
              selectedKey={selected?.flow.id ?? null}
              empty="Sem fluxo principal"
            />
          </div>
        ) : !search ? (
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
        ) : (
          <div className="py-8 text-center text-(--text-ghost) text-sm">Nada no Principal para “{search}”.</div>
        )}

        {/* ═══ BLACK ═══ */}
        {showBlackSection && (
          <div className="mt-2">
            <div className="flex items-center justify-between">
              <RowGroupHeader label="Black" count={groups.black.length} accent="amber" />
              <button
                onClick={handleToggleBlack}
                disabled={togglingBlack}
                className={`shrink-0 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  blackOn
                    ? "text-(--red) border border-(--red)/20"
                    : "text-(--text-muted) border border-(--border-subtle) hover:bg-white/4"
                }`}
                style={blackOn
                  ? { background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)", boxShadow: "0 0 12px -4px rgba(255,59,107,0.25)" }
                  : { background: "rgba(255,255,255,0.03)" }}
              >
                {togglingBlack ? "..." : blackOn ? "Ativado" : "Desativado"}
              </button>
            </div>
            <p className="text-(--text-muted) text-xs mb-2 px-3">
              Via /start com payload válido (tráfego pago). Mensagens auto-deletadas em 15 minutos.
            </p>
            {blackOn ? (
              groups.black.length > 0 ? (
                <div className="card overflow-x-auto">
                  <DataGrid
                    columns={columns}
                    rows={groups.black}
                    rowKey={(r) => r.flow.id}
                    onRowClick={(r) => setSelected(r)}
                    selectedKey={selected?.flow.id ?? null}
                    empty="Sem fluxo black"
                  />
                </div>
              ) : !search ? (
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
              ) : (
                <div className="py-8 text-center text-(--text-ghost) text-sm">Nada no Black para “{search}”.</div>
              )
            ) : (
              <div className="w-full py-5 border border-dashed border-(--border-subtle) rounded-2xl text-(--text-ghost) text-sm text-center">
                Ative o Flow Black para configurar
              </div>
            )}
          </div>
        )}

        {/* ═══ OUTROS ═══ */}
        <div className="mt-2">
          <RowGroupHeader label="Outros" count={groups.outros.length} accent="cyan" />
          {groups.outros.length > 0 ? (
            <div className="card overflow-x-auto">
              <DataGrid
                columns={columns}
                rows={groups.outros}
                rowKey={(r) => r.flow.id}
                onRowClick={(r) => setSelected(r)}
                selectedKey={selected?.flow.id ?? null}
                empty="Nenhum fluxo adicional"
              />
            </div>
          ) : (
            <div className="py-10 text-center text-(--text-muted) text-sm">
              {search
                ? `Nenhum fluxo adicional para “${search}”.`
                : "Nenhum fluxo adicional. Crie fluxos extras para comandos como /help, /preco, etc."}
            </div>
          )}
        </div>
      </div>

      {/* ═══ ROW DETAIL DRAWER ═══ */}
      <ContextDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.label || "Fluxo"}
        subtitle={selected ? (selected.variant === "plain" ? "detalhe do fluxo" : selected.variant === "visual" ? "_visual_flow" : "_black_flow") : undefined}
        actions={
          selected && (
            <a
              href={`${base}/flows/${selected.flow.id}/editor`}
              className="btn-primary py-1.5! text-xs!"
            >
              Abrir editor
            </a>
          )
        }
      >
        {selected && (
          <div className="space-y-4">
            <DetailRow label="Nome" value={selected.flow.name} />
            <DetailRow
              label="Trigger"
              value={selected.flow.trigger_type === "command" ? selected.flow.trigger_value : triggerLabel(selected.flow)}
              mono={selected.flow.trigger_type === "command"}
            />
            <DetailRow label="Tipo de gatilho" value={TRIGGER_TYPE_LABEL[selected.flow.trigger_type]} />
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Nós" value={String(selected.flow.flow_data.nodes.length)} accent="var(--cyan)" />
              <Stat label="Versão" value={`v${selected.flow.version}`} accent="var(--accent)" />
            </div>
            <DetailRow label="Status" value={selected.flow.is_active ? "Ativo" : "Inativo"} />
            <div className="divider my-2" />
            <DetailRow label="ID" value={selected.flow.id} mono />
            <DetailRow label="Criado em" value={new Date(selected.flow.created_at).toLocaleString("pt-BR")} />
            <DetailRow label="Atualizado em" value={new Date(selected.flow.updated_at).toLocaleString("pt-BR")} />

            <div className="divider my-2" />
            <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">Ações</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`${base}/flows/${selected.flow.id}/editor`}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all bg-(--accent-muted) text-(--accent) hover:bg-(--accent)/15"
              >
                Abrir editor
              </a>
              <button
                onClick={() => handleToggle(selected.flow.id, selected.flow.is_active)}
                className={`toggle-btn ${selected.flow.is_active ? "on" : "off"}`}
              >
                {selected.flow.is_active ? "Desativar" : "Ativar"}
              </button>
              <button
                onClick={async () => {
                  setRowBusy(true);
                  await handleExport(selected.flow);
                  setRowBusy(false);
                }}
                disabled={rowBusy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all text-(--text-secondary) border border-(--border-subtle) hover:bg-white/4 disabled:opacity-50"
              >
                {rowBusy ? "..." : "Exportar"}
              </button>
              {selected.variant === "plain" && (
                <button onClick={() => handleDelete(selected.flow.id)} className="btn-danger py-1.5!">
                  Excluir
                </button>
              )}
            </div>
            {selected.variant !== "plain" && (
              <p className="text-[11px] text-(--text-ghost)">
                Fluxos {selected.variant === "visual" ? "principal" : "black"} são fixos e não podem ser excluídos.
              </p>
            )}
          </div>
        )}
      </ContextDrawer>

      {/* ═══ NOVO FLUXO DRAWER ═══ */}
      <ContextDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Novo Fluxo"
        subtitle="criar fluxo de mensagens"
      >
        <div className="space-y-4">
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
          <div className="flex gap-2 pt-2">
            <button onClick={handleCreate} disabled={loading} className="btn-primary">
              {loading ? "Criando..." : "Criar Fluxo"}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </div>
      </ContextDrawer>

      {/* ═══ IMPORTAR FLUXO DRAWER ═══ */}
      <ContextDrawer
        open={showImport}
        onClose={() => { setShowImport(false); setImportFile(null); setImportError(null); }}
        title="Importar Fluxo"
        subtitle="restaurar a partir de JSON"
      >
        <div className="space-y-4">
          <div>
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

          <div>
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

          {importError && <p className="text-(--red) text-xs">{importError}</p>}

          <div className="flex gap-2 pt-2">
            <button onClick={handleImport} disabled={importing} className="btn-primary">
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
      </ContextDrawer>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">{label}</span>
      <span className={`text-sm text-foreground text-right truncate ${mono ? "font-mono stat-value text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="px-3 py-2.5 rounded-lg bg-white/3 border border-(--border-subtle)">
      <p className="stat-value text-lg num-pop" style={{ color: accent }}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-(--text-ghost)">{label}</p>
    </div>
  );
}
