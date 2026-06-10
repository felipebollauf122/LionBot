"use client";

import { useMemo, useState } from "react";
import { createProduct, deleteProduct, updateProduct } from "@/lib/actions/product-actions";
import type { Product } from "@/lib/types/database";
import { CommandBar, CommandSearch, KpiPill } from "@/components/dashboard/console/command-bar";
import { DataGrid, type Column } from "@/components/dashboard/console/data-grid";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";

interface ProductListProps {
  botId: string;
  initialProducts: Product[];
  blackEnabled: boolean;
  isAdmin?: boolean;
}

type DrawerMode = "create" | "edit";

export function ProductList({ botId, initialProducts, blackEnabled, isAdmin }: ProductListProps) {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Create form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editGhostName, setEditGhostName] = useState("");
  const [editGhostDescription, setEditGhostDescription] = useState("");
  const [editButtonStyle, setEditButtonStyle] = useState<"" | "danger" | "success" | "primary">("");
  const [editSaving, setEditSaving] = useState(false);

  const closeDrawer = () => {
    setDrawerMode(null);
    setEditingId(null);
  };

  const openCreate = () => {
    setName("");
    setPrice("");
    setDescription("");
    setEditingId(null);
    setDrawerMode("create");
  };

  const handleCreate = async () => {
    if (!name || !price) return;
    setSaving(true);
    try {
      await createProduct(botId, name, Math.round(parseFloat(price) * 100), "BRL", description);
      window.location.reload();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (productId: string) => {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;
    try {
      await deleteProduct(productId);
      setProducts(products.filter((p) => p.id !== productId));
      closeDrawer();
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggle = async (productId: string, isActive: boolean) => {
    try {
      await updateProduct(productId, { is_active: !isActive });
      setProducts(products.map((p) => p.id === productId ? { ...p, is_active: !isActive } : p));
    } catch (e) {
      console.error(e);
    }
  };

  const startEditing = (product: Product) => {
    setEditingId(product.id);
    setEditName(product.name);
    setEditPrice(String(product.price / 100));
    setEditDescription(product.description);
    setEditGhostName(product.ghost_name ?? "");
    setEditGhostDescription(product.ghost_description ?? "");
    setEditButtonStyle((product.button_style as "" | "danger" | "success" | "primary") ?? "");
    setDrawerMode("edit");
  };

  const handleSaveEdit = async (productId: string) => {
    setEditSaving(true);
    try {
      const updates: Parameters<typeof updateProduct>[1] = {
        name: editName,
        price: Math.round(parseFloat(editPrice) * 100),
        description: editDescription,
        button_style: editButtonStyle || null,
        ...(isAdmin ? {
          ghost_name: editGhostName.trim() || null,
          ghost_description: editGhostDescription.trim() || null,
        } : {}),
      };
      await updateProduct(productId, updates);
      setProducts(products.map((p) =>
        p.id === productId
          ? {
              ...p,
              name: editName,
              price: Math.round(parseFloat(editPrice) * 100),
              description: editDescription,
              button_style: editButtonStyle || null,
              ...(isAdmin ? {
                ghost_name: editGhostName.trim() || null,
                ghost_description: editGhostDescription.trim() || null,
              } : {}),
            }
          : p,
      ));
      closeDrawer();
    } catch (e) {
      console.error(e);
    } finally {
      setEditSaving(false);
    }
  };

  const editingProduct = editingId ? products.find((p) => p.id === editingId) ?? null : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      (p.ghost_name || p.name).toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.ghost_description || p.description || "").toLowerCase().includes(q)
    );
  }, [products, search]);

  const activeCount = useMemo(() => products.filter((p) => p.is_active).length, [products]);

  const columns: Column<Product>[] = [
    {
      key: "price",
      header: "Preço",
      width: "92px",
      cell: (p) => (
        <span
          className="inline-flex items-baseline gap-1 px-2.5 py-1 rounded-lg stat-value font-bold text-(--accent)"
          style={{ background: "linear-gradient(135deg, rgba(255, 43, 214, 0.10) 0%, rgba(255, 43, 214, 0.03) 100%)", boxShadow: "0 0 12px -6px rgba(255,43,214,0.2)" }}
        >
          {(p.price / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          <span className="text-(--accent)/60 text-[9px] font-semibold uppercase">{p.currency || "BRL"}</span>
        </span>
      ),
    },
    {
      key: "name",
      header: "Nome",
      cell: (p) => (
        <div className="min-w-0">
          <p className="text-foreground font-medium truncate">{p.ghost_name || p.name}</p>
          <p className="text-[10px] text-(--text-ghost) font-mono stat-value truncate">{p.id}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <span className={`badge ${p.is_active ? "badge-active" : "badge-inactive"}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${p.is_active ? "bg-(--accent)" : "bg-(--text-ghost)"}`} />
          {p.is_active ? "Ativo" : "Inativo"}
        </span>
      ),
    },
    {
      key: "description",
      header: "Descrição",
      secondary: true,
      cell: (p) => (
        <span className="text-(--text-muted) text-xs block max-w-70 truncate">
          {p.ghost_description || p.description || "—"}
        </span>
      ),
    },
    ...(isAdmin
      ? [{
          key: "ghost",
          header: "Fantasma",
          secondary: true,
          cell: (p: Product) =>
            p.ghost_name ? (
              <span className="badge badge-error text-[10px]">{p.ghost_name}</span>
            ) : (
              <span className="text-(--text-ghost)">—</span>
            ),
        } as Column<Product>]
      : []),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Produtos"
        subtitle="catálogo do bot"
        search={<CommandSearch value={search} onChange={setSearch} placeholder="Buscar por nome ou descrição..." />}
        kpis={
          <>
            <KpiPill label="total" value={products.length.toLocaleString("pt-BR")} accent="magenta" />
            <KpiPill label="ativos" value={activeCount.toLocaleString("pt-BR")} accent="cyan" />
          </>
        }
        action={
          <button onClick={openCreate} className="btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo Produto
          </button>
        }
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6">
        <div className="card overflow-x-auto">
          <DataGrid
            columns={columns}
            rows={filtered}
            rowKey={(p) => p.id}
            onRowClick={(p) => startEditing(p)}
            selectedKey={editingId}
            empty={search ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
          />
        </div>
      </div>

      {/* Create drawer */}
      <ContextDrawer
        open={drawerMode === "create"}
        onClose={closeDrawer}
        title="Novo Produto"
        subtitle="criar produto"
      >
        <div className="space-y-3">
          <div>
            <label className="input-label">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Curso de Marketing Digital" className="input" />
          </div>
          <div>
            <label className="input-label">Preco (R$)</label>
            <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="97.00" className="input" />
          </div>
          <div>
            <label className="input-label">Descricao</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Descricao do produto..." className="input resize-none" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate} disabled={saving} className="btn-primary">
              {saving ? "Criando..." : "Criar Produto"}
            </button>
            <button onClick={closeDrawer} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </ContextDrawer>

      {/* Edit drawer */}
      <ContextDrawer
        open={drawerMode === "edit"}
        onClose={closeDrawer}
        title={editingProduct?.ghost_name || editingProduct?.name || "Produto"}
        subtitle="editar produto"
        actions={
          editingProduct ? (
            <>
              <button onClick={() => handleToggle(editingProduct.id, editingProduct.is_active)} className="toggle-btn off text-xs!">
                {editingProduct.is_active ? "Desativar" : "Ativar"}
              </button>
              <button onClick={() => handleDelete(editingProduct.id)} className="btn-danger py-1.5!">
                Excluir
              </button>
            </>
          ) : null
        }
      >
        {editingProduct && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="input-label">Nome real (oculto na lista)</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="input" />
                <p className="text-(--text-muted) text-[10px] mt-1">Visto pelo cliente no chat do bot.</p>
              </div>
              <div>
                <label className="input-label">Preco (R$)</label>
                <input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="input" />
              </div>
            </div>
            <div>
              <label className="input-label">Descricao real</label>
              <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} className="input resize-none" />
            </div>
            <div>
              <label className="input-label">Cor do botão de pagamento</label>
              <select
                value={editButtonStyle}
                onChange={(e) => setEditButtonStyle(e.target.value as "" | "danger" | "success" | "primary")}
                className="input"
              >
                <option value="">Padrão (tema do cliente)</option>
                <option value="danger">🔴 Vermelho</option>
                <option value="success">🟢 Verde</option>
                <option value="primary">🔵 Azul</option>
              </select>
              <p className="text-(--text-muted) text-[10px] mt-1">
                Funciona em clientes Telegram atualizados (Bot API 8+). Versões antigas mostram a cor padrão.
              </p>
            </div>

            {isAdmin && (
              <div className="border-t border-(--border-subtle) pt-4 mt-4 relative">
                <div className="absolute top-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-(--red)/20 to-transparent" />
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="section-icon w-6 h-6" style={{ background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  </div>
                  <span className="badge badge-error text-[10px]">FANTASMA</span>
                  <span className="text-(--text-muted) text-[10px]">Enviado pra gateway (fatura PIX) em qualquer fluxo. Cliente continua vendo o nome real. Fallback pro real se vazio.</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">Nome Fantasma</label>
                    <input
                      type="text"
                      value={editGhostName}
                      onChange={(e) => setEditGhostName(e.target.value)}
                      placeholder="Nome alternativo para o gateway"
                      className="input"
                      style={{ borderColor: "rgba(255,59,107,0.15)" }}
                    />
                  </div>
                  <div>
                    <label className="input-label">Descricao Fantasma</label>
                    <input
                      type="text"
                      value={editGhostDescription}
                      onChange={(e) => setEditGhostDescription(e.target.value)}
                      placeholder="Descricao alternativa"
                      className="input"
                      style={{ borderColor: "rgba(255,59,107,0.15)" }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={() => handleSaveEdit(editingProduct.id)} disabled={editSaving} className="btn-primary">
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
