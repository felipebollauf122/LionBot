"use client";

import { useMemo, useState } from "react";
import { createMediaAsset, deleteMediaAsset, updateMediaAsset } from "@/lib/actions/media-actions";
import type { MediaAsset } from "@/lib/types/database";
import { CommandBar, CommandSearch, KpiPill } from "@/components/dashboard/console/command-bar";
import { DataGrid, type Column } from "@/components/dashboard/console/data-grid";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";
import { MediaUpload } from "@/components/dashboard/flow-builder/config-forms/media-upload";

interface MediaListProps {
  botId: string;
  initialAssets: MediaAsset[];
}

type DrawerMode = "create" | "edit";

const IMAGE_ACCEPT = "image/jpeg,image/png,image/gif,image/webp";
const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";

function assetDisplayLabel(asset: MediaAsset): string {
  if (asset.label) return asset.label;
  let filename = asset.url;
  try {
    const u = new URL(asset.url);
    const parts = u.pathname.split("/");
    filename = decodeURIComponent(parts[parts.length - 1] || asset.url);
  } catch {
    const parts = asset.url.split("/");
    filename = parts[parts.length - 1] || asset.url;
  }
  return filename.length > 34 ? `${filename.slice(0, 31)}...` : filename;
}

export function MediaList({ botId, initialAssets }: MediaListProps) {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState("");
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create form state
  const [createKind, setCreateKind] = useState<"image" | "video">("image");
  const [createLabel, setCreateLabel] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit form state
  const [editLabel, setEditLabel] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingId(null);
  };

  const openCreate = () => {
    setCreateKind("image");
    setCreateLabel("");
    setCreateUrl("");
    setEditingId(null);
    setDrawerMode("create");
  };

  const handleUploaded = async (url: string) => {
    setCreateUrl(url);
    if (!url || creating) return;
    setCreating(true);
    try {
      await createMediaAsset(botId, url, createKind, createLabel.trim() || undefined);
      window.location.reload();
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  const handleDelete = async (assetId: string) => {
    if (!confirm("Tem certeza que deseja excluir esta mídia?")) return;
    try {
      await deleteMediaAsset(assetId);
      setAssets(assets.filter((a) => a.id !== assetId));
      closeDrawer();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggle = async (assetId: string, isActive: boolean) => {
    try {
      await updateMediaAsset(assetId, { is_active: !isActive });
      setAssets(assets.map((a) => a.id === assetId ? { ...a, is_active: !isActive } : a));
    } catch (e) {
      console.error(e);
    }
  };

  const startEditing = (asset: MediaAsset) => {
    setEditingId(asset.id);
    setEditLabel(asset.label ?? "");
    setDrawerMode("edit");
  };

  const handleSaveEdit = async (assetId: string) => {
    setEditSaving(true);
    try {
      const label = editLabel.trim() || null;
      await updateMediaAsset(assetId, { label });
      setAssets(assets.map((a) => a.id === assetId ? { ...a, label } : a));
      closeDrawer();
    } catch (e) {
      console.error(e);
    } finally {
      setEditSaving(false);
    }
  };

  const editingAsset = editingId ? assets.find((a) => a.id === editingId) ?? null : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => assetDisplayLabel(a).toLowerCase().includes(q));
  }, [assets, search]);

  const activeCount = useMemo(() => assets.filter((a) => a.is_active).length, [assets]);

  const columns: Column<MediaAsset>[] = [
    {
      key: "preview",
      header: "",
      width: "56px",
      cell: (a) =>
        a.kind === "image" ? (
          <img src={a.url} alt="" className="w-9 h-9 rounded-lg object-cover border border-(--border-subtle)" />
        ) : (
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.03] border border-(--border-subtle)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
        ),
    },
    {
      key: "label",
      header: "Nome",
      cell: (a) => (
        <div className="min-w-0">
          <p className="text-foreground font-medium truncate">{assetDisplayLabel(a)}</p>
          <p className="text-[10px] text-(--text-ghost) font-mono stat-value truncate">{a.id}</p>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Tipo",
      cell: (a) => (
        <span className={`badge ${a.kind === "image" ? "badge-info" : "badge-purple"}`}>
          {a.kind === "image" ? "Imagem" : "Vídeo"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => (
        <span className={`badge ${a.is_active ? "badge-active" : "badge-inactive"}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${a.is_active ? "bg-(--accent)" : "bg-(--text-ghost)"}`} />
          {a.is_active ? "Ativo" : "Inativo"}
        </span>
      ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Mídia"
        subtitle="biblioteca de mídia"
        search={<CommandSearch value={search} onChange={setSearch} placeholder="Buscar por nome..." />}
        kpis={
          <>
            <KpiPill label="total" value={assets.length.toLocaleString("pt-BR")} accent="magenta" />
            <KpiPill label="ativos" value={activeCount.toLocaleString("pt-BR")} accent="cyan" />
          </>
        }
        action={
          <button onClick={openCreate} className="btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova Mídia
          </button>
        }
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6">
        <div className="card overflow-x-auto">
          <DataGrid
            columns={columns}
            rows={filtered}
            rowKey={(a) => a.id}
            onRowClick={(a) => startEditing(a)}
            selectedKey={editingId}
            empty={search ? "Nenhuma mídia encontrada" : "Nenhuma mídia cadastrada"}
          />
        </div>
      </div>

      {/* Create drawer */}
      <ContextDrawer
        open={drawerMode === "create"}
        onClose={closeDrawer}
        title="Nova Mídia"
        subtitle="adicionar mídia"
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setCreateKind("image"); setCreateUrl(""); }}
              className={`toggle-btn ${createKind === "image" ? "on" : "off"} flex-1`}
            >
              Imagem
            </button>
            <button
              type="button"
              onClick={() => { setCreateKind("video"); setCreateUrl(""); }}
              className={`toggle-btn ${createKind === "video" ? "on" : "off"} flex-1`}
            >
              Vídeo
            </button>
          </div>
          <div>
            <label className="input-label">Nome (opcional)</label>
            <input type="text" value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} placeholder="Ex: Banner promoção" className="input" />
          </div>
          <MediaUpload
            value={createUrl}
            onChange={handleUploaded}
            accept={createKind === "image" ? IMAGE_ACCEPT : VIDEO_ACCEPT}
            label={createKind === "image" ? "Imagem" : "Vídeo"}
          />
          {creating && <p className="text-(--text-muted) text-[10px]">Salvando...</p>}
        </div>
      </ContextDrawer>

      {/* Edit drawer */}
      <ContextDrawer
        open={drawerMode === "edit"}
        onClose={closeDrawer}
        title={editingAsset ? assetDisplayLabel(editingAsset) : "Mídia"}
        subtitle="editar mídia"
        actions={
          editingAsset ? (
            <>
              <button onClick={() => handleToggle(editingAsset.id, editingAsset.is_active)} className="toggle-btn off text-xs!">
                {editingAsset.is_active ? "Desativar" : "Ativar"}
              </button>
              <button onClick={() => handleDelete(editingAsset.id)} className="btn-danger py-1.5!">
                Excluir
              </button>
            </>
          ) : null
        }
      >
        {editingAsset && (
          <div className="space-y-3">
            {editingAsset.kind === "image" ? (
              <img src={editingAsset.url} alt="" className="w-full max-h-48 object-contain rounded-xl border border-(--border-subtle) bg-white/[0.02]" />
            ) : (
              <div className="w-full h-24 rounded-xl border border-(--border-subtle) bg-white/[0.02] flex items-center justify-center gap-2 text-(--text-muted)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <span className="text-xs">Vídeo</span>
              </div>
            )}
            <div>
              <label className="input-label">Nome</label>
              <input type="text" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Ex: Banner promoção" className="input" />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => handleSaveEdit(editingAsset.id)} disabled={editSaving} className="btn-primary">
                {editSaving ? "Salvando..." : "Salvar"}
              </button>
              <button onClick={closeDrawer} className="btn-ghost">Cancelar</button>
            </div>
          </div>
        )}
      </ContextDrawer>
    </div>
  );
}
