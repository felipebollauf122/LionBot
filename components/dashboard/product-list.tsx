"use client";

import { useState } from "react";
import { createProduct, deleteProduct, updateProduct } from "@/lib/actions/product-actions";
import type { Product } from "@/lib/types/database";

interface ProductListProps {
  botId: string;
  initialProducts: Product[];
  blackEnabled: boolean;
  isAdmin?: boolean;
}

export function ProductList({ botId, initialProducts, blackEnabled, isAdmin }: ProductListProps) {
  const [products, setProducts] = useState(initialProducts);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");

  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editGhostName, setEditGhostName] = useState("");
  const [editGhostDescription, setEditGhostDescription] = useState("");
  const [editButtonStyle, setEditButtonStyle] = useState<"" | "danger" | "success" | "primary">("");
  const [editSaving, setEditSaving] = useState(false);

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
  };

  const cancelEditing = () => {
    setEditingId(null);
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
      setEditingId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight page-title">Produtos</h1>
          <p className="text-(--text-secondary) text-sm mt-1">Gerencie os produtos vendidos por este bot</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo Produto
        </button>
      </div>

      {showForm && (
        <div className="card p-4 sm:p-6 mb-6 animate-scale relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/30 to-transparent" />
          <h3 className="text-foreground font-semibold text-sm mb-4 tracking-tight">Novo Produto</h3>
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
              <button onClick={() => setShowForm(false)} className="btn-ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        <div className="text-center py-20 animate-up">
          <div className="section-icon w-14 h-14 mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(255, 43, 214, 0.12) 0%, rgba(255, 43, 214, 0.04) 100%)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01" />
            </svg>
          </div>
          <p className="text-(--text-muted) text-sm">Nenhum produto cadastrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <div key={product.id} className="card p-5 relative group">
              {editingId === product.id ? (
                <div className="space-y-3 animate-in">
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
                      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-(--red)/20 to-transparent" />
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
                    <button onClick={() => handleSaveEdit(product.id)} disabled={editSaving} className="btn-primary">
                      {editSaving ? "Salvando..." : "Salvar"}
                    </button>
                    <button onClick={cancelEditing} className="btn-ghost">Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Price badge */}
                    <div className="w-16 h-16 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, rgba(255, 43, 214, 0.10) 0%, rgba(255, 43, 214, 0.03) 100%)", boxShadow: "0 0 12px -6px rgba(255,43,214,0.2)" }}>
                      <span className="text-(--accent) text-sm font-bold stat-value leading-none">
                        {(product.price / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-(--accent)/60 text-[9px] font-semibold uppercase mt-0.5">BRL</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-foreground font-semibold text-sm tracking-tight">
                          {product.ghost_name || product.name}
                        </h3>
                        <span className={`badge ${product.is_active ? "badge-active" : "badge-inactive"}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${product.is_active ? "bg-(--accent)" : "bg-(--text-ghost)"}`} />
                          {product.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                      <p className="text-(--text-muted) text-xs mt-1">
                        {product.ghost_description || product.description}
                      </p>
                      <p className="text-(--text-ghost) text-[10px] mt-1.5 font-mono stat-value">{product.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEditing(product)} className="px-3 py-1.5 text-xs font-semibold bg-(--accent-muted) text-(--accent) rounded-lg hover:bg-(--accent)/15 transition-all">
                      Editar
                    </button>
                    <button onClick={() => handleToggle(product.id, product.is_active)} className="toggle-btn off text-xs!">
                      {product.is_active ? "Desativar" : "Ativar"}
                    </button>
                    <button onClick={() => handleDelete(product.id)} className="btn-danger py-1.5!">
                      Excluir
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
