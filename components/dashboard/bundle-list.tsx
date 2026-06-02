"use client";

import { useState, useTransition } from "react";
import { createBundle, deleteBundle, addProductToBundle, removeProductFromBundle, updateBundle } from "@/lib/actions/bundle-actions";

interface Product {
  id: string;
  name: string;
  ghost_name?: string | null;
  price: number;
  currency: string;
  is_active: boolean;
}

interface BundleItem {
  id: string;
  product_id: string;
  sort_order: number;
  products: Product;
}

interface Bundle {
  id: string;
  name: string;
  ghost_name: string | null;
  description: string;
  message_text: string;
  is_active: boolean;
  product_bundle_items: BundleItem[];
}

interface BundleListProps {
  botId: string;
  initialBundles: Bundle[];
  products: Product[];
  isAdmin?: boolean;
}

export function BundleList({ botId, initialBundles, products, isAdmin = false }: BundleListProps) {
  const [bundles, setBundles] = useState(initialBundles);
  const [isPending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMessage, setNewMessage] = useState("Escolha um produto para comprar:");
  const [expandedBundle, setExpandedBundle] = useState<string | null>(null);
  const [addingProduct, setAddingProduct] = useState<string | null>(null);
  const [editGhostBundle, setEditGhostBundle] = useState<string | null>(null);
  const [editGhostValue, setEditGhostValue] = useState("");

  const handleSaveGhost = (bundleId: string) => {
    const value = editGhostValue.trim() || null;
    startTransition(async () => {
      try {
        await updateBundle(bundleId, { ghost_name: value });
        setBundles((prev) => prev.map((b) => (b.id === bundleId ? { ...b, ghost_name: value } : b)));
        setEditGhostBundle(null);
      } catch (e) {
        console.error(e);
      }
    });
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      try {
        const result = await createBundle(botId, newName, "", newMessage);
        setBundles((prev) => [
          { id: result.id, name: newName, ghost_name: null, description: "", message_text: newMessage, is_active: true, product_bundle_items: [] },
          ...prev,
        ]);
        setNewName("");
        setNewMessage("Escolha um produto para comprar:");
        setShowCreate(false);
      } catch (e) {
        console.error(e);
      }
    });
  };

  const handleDelete = (bundleId: string) => {
    startTransition(async () => {
      try {
        await deleteBundle(bundleId);
        setBundles((prev) => prev.filter((b) => b.id !== bundleId));
      } catch (e) {
        console.error(e);
      }
    });
  };

  const handleAddProduct = (bundleId: string, productId: string) => {
    startTransition(async () => {
      try {
        const bundle = bundles.find((b) => b.id === bundleId);
        const sortOrder = bundle ? bundle.product_bundle_items.length : 0;
        await addProductToBundle(bundleId, productId, sortOrder);
        const product = products.find((p) => p.id === productId);
        if (product) {
          setBundles((prev) =>
            prev.map((b) =>
              b.id === bundleId
                ? {
                    ...b,
                    product_bundle_items: [
                      ...b.product_bundle_items,
                      { id: `temp-${Date.now()}`, product_id: productId, sort_order: sortOrder, products: product },
                    ],
                  }
                : b,
            ),
          );
        }
        setAddingProduct(null);
      } catch (e) {
        console.error(e);
      }
    });
  };

  const handleRemoveProduct = (bundleId: string, itemId: string) => {
    startTransition(async () => {
      try {
        await removeProductFromBundle(itemId);
        setBundles((prev) =>
          prev.map((b) =>
            b.id === bundleId
              ? { ...b, product_bundle_items: b.product_bundle_items.filter((i) => i.id !== itemId) }
              : b,
          ),
        );
      } catch (e) {
        console.error(e);
      }
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight page-title">Conjuntos</h1>
          <p className="text-(--text-secondary) text-sm mt-1">Agrupe seus produtos em conjuntos para usar no fluxo de pagamento</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo Conjunto
        </button>
      </div>

      {showCreate && (
        <div className="card p-6 mb-6 animate-scale relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--purple)/30 to-transparent" />
          <h2 className="text-foreground font-semibold text-sm mb-4 tracking-tight">Criar Conjunto</h2>
          <div className="space-y-3">
            <div>
              <label className="input-label">Nome do Conjunto</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Plano Premium" className="input" />
            </div>
            <div>
              <label className="input-label">Mensagem no Telegram</label>
              <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Escolha um produto para comprar:" className="input" />
              <p className="text-(--text-ghost) text-[10px] mt-1.5">Texto que aparece antes dos produtos no Telegram</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleCreate} disabled={isPending || !newName.trim()} className="btn-primary">Criar</button>
              <button onClick={() => setShowCreate(false)} className="btn-ghost">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {bundles.length === 0 && !showCreate ? (
        <div className="text-center py-20 animate-up">
          <div className="section-icon w-14 h-14 mx-auto mb-4" style={{ background: "linear-gradient(135deg, rgba(167, 139, 250, 0.12) 0%, rgba(167, 139, 250, 0.04) 100%)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            </svg>
          </div>
          <p className="text-(--text-muted) text-sm">Nenhum conjunto criado</p>
          <p className="text-(--text-ghost) text-xs mt-1">Crie um conjunto para agrupar seus produtos</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bundles.map((bundle) => {
            const isExpanded = expandedBundle === bundle.id;
            const bundleProducts = bundle.product_bundle_items;
            const availableProducts = products.filter(
              (p) => p.is_active && !bundleProducts.some((bp) => bp.product_id === p.id),
            );

            return (
              <div key={bundle.id} className="card overflow-hidden relative group">
                {/* Top accent */}
                <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--purple)/15 to-transparent" />

                <div
                  className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/2 transition-colors"
                  onClick={() => setExpandedBundle(isExpanded ? null : bundle.id)}
                >
                  <div className="flex items-center gap-3.5">
                    <div className="section-icon w-10 h-10" style={{ background: "linear-gradient(135deg, rgba(167, 139, 250, 0.14) 0%, rgba(167, 139, 250, 0.04) 100%)" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-foreground font-semibold text-sm tracking-tight">{bundle.name}</h3>
                        <span className="text-(--text-muted) text-[11px] stat-value">
                          {bundleProducts.length} produto{bundleProducts.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <p className="text-(--text-ghost) text-[10px] mt-0.5 font-mono stat-value">{bundle.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(bundle.id); }}
                      disabled={isPending}
                      className="btn-danger py-1.5!"
                    >
                      Excluir
                    </button>
                    <div className={`w-7 h-7 rounded-lg bg-white/4 flex items-center justify-center transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-(--border-subtle) p-5 animate-in relative">
                    <p className="text-(--text-muted) text-xs mb-4">
                      Mensagem: <span className="text-(--text-secondary) font-medium">{bundle.message_text}</span>
                    </p>

                    {isAdmin && (
                      <div className="mb-4 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="badge badge-error text-[10px]">FANTASMA</span>
                          <span className="text-(--text-muted) text-[10px]">Enviado pro Facebook (ViewContent) no lugar do nome real. Fallback pro nome se vazio.</span>
                        </div>
                        {editGhostBundle === bundle.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editGhostValue}
                              onChange={(e) => setEditGhostValue(e.target.value)}
                              placeholder="Nome fantasma do conjunto"
                              className="input text-sm flex-1"
                            />
                            <button
                              onClick={() => handleSaveGhost(bundle.id)}
                              disabled={isPending}
                              className="btn-primary py-1.5! px-3 text-xs"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setEditGhostBundle(null)}
                              className="text-(--text-muted) hover:text-foreground text-xs px-2"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-(--text-secondary) text-sm">
                              {bundle.ghost_name ? (
                                <>FANTASMA: <span className="text-red-300 font-medium">{bundle.ghost_name}</span></>
                              ) : (
                                <span className="text-(--text-ghost) italic">Nenhum nome fantasma (FB recebe o nome real)</span>
                              )}
                            </span>
                            <button
                              onClick={() => {
                                setEditGhostValue(bundle.ghost_name ?? "");
                                setEditGhostBundle(bundle.id);
                              }}
                              className="text-(--accent) hover:underline text-xs"
                            >
                              {bundle.ghost_name ? "Editar" : "Definir"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {bundleProducts.length > 0 ? (
                      <div className="space-y-2 mb-4">
                        {bundleProducts
                          .sort((a, b) => a.sort_order - b.sort_order)
                          .map((item) => (
                            <div key={item.id} className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}>
                              <div className="flex items-center gap-3">
                                <span className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold stat-value" style={{ background: "color-mix(in srgb, var(--purple) 12%, transparent)", color: "var(--purple)" }}>
                                  {item.sort_order + 1}
                                </span>
                                <span className="text-foreground text-sm font-medium">{item.products.ghost_name || item.products.name}</span>
                                <span className="text-(--accent) text-xs stat-value">
                                  {(item.products.price / 100).toLocaleString("pt-BR", { style: "currency", currency: item.products.currency })}
                                </span>
                              </div>
                              <button
                                onClick={() => handleRemoveProduct(bundle.id, item.id)}
                                disabled={isPending}
                                className="text-(--red)/50 hover:text-(--red) text-xs font-medium transition-colors"
                              >
                                Remover
                              </button>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-(--text-ghost) text-xs mb-4">Nenhum produto neste conjunto</p>
                    )}

                    {addingProduct === bundle.id ? (
                      <div className="space-y-2">
                        <p className="text-(--text-secondary) text-xs font-semibold uppercase tracking-wider">Selecione um produto:</p>
                        {availableProducts.length === 0 ? (
                          <p className="text-(--text-ghost) text-xs">Todos os produtos ja estao neste conjunto</p>
                        ) : (
                          <div className="space-y-1">
                            {availableProducts.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => handleAddProduct(bundle.id, p.id)}
                                disabled={isPending}
                                className="w-full text-left px-4 py-3 rounded-xl text-sm text-foreground transition-all flex items-center justify-between group/item"
                                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}
                              >
                                <span className="group-hover/item:text-(--accent) transition-colors">{p.ghost_name || p.name}</span>
                                <span className="text-(--accent) text-xs stat-value">
                                  {(p.price / 100).toLocaleString("pt-BR", { style: "currency", currency: p.currency })}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        <button onClick={() => setAddingProduct(null)} className="text-(--text-muted) text-xs hover:text-(--text-secondary) transition-colors font-medium">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingProduct(bundle.id)}
                        className="px-4 py-2 text-xs font-semibold rounded-lg transition-all"
                        style={{ background: "color-mix(in srgb, var(--purple) 10%, transparent)", color: "var(--purple)" }}
                      >
                        + Adicionar Produto
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
