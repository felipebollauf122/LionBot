"use client";

import { useState, useTransition } from "react";
import { createBundle, deleteBundle, addProductToBundle, removeProductFromBundle, updateBundle } from "@/lib/actions/bundle-actions";
import { CommandBar, CommandSearch, KpiPill } from "@/components/dashboard/console/command-bar";
import { DataGrid, type Column } from "@/components/dashboard/console/data-grid";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";

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
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMessage, setNewMessage] = useState("Escolha um produto para comprar:");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingProduct, setAddingProduct] = useState(false);
  const [editGhostBundle, setEditGhostBundle] = useState<string | null>(null);
  const [editGhostValue, setEditGhostValue] = useState("");
  const [editMsgBundle, setEditMsgBundle] = useState<string | null>(null);
  const [editMsgValue, setEditMsgValue] = useState("");

  // selected bundle is read live from state so add/remove/edit reflect instantly
  const selected = selectedId ? bundles.find((b) => b.id === selectedId) ?? null : null;

  const filtered = search.trim()
    ? bundles.filter((b) => (b.ghost_name || b.name).toLowerCase().includes(search.trim().toLowerCase()))
    : bundles;

  const closeDrawer = () => {
    setSelectedId(null);
    setAddingProduct(false);
    setEditGhostBundle(null);
    setEditMsgBundle(null);
  };

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

  const handleSaveMessage = (bundleId: string) => {
    const value = editMsgValue.trim() || "Escolha um produto para comprar:";
    startTransition(async () => {
      try {
        await updateBundle(bundleId, { message_text: value });
        setBundles((prev) => prev.map((b) => (b.id === bundleId ? { ...b, message_text: value } : b)));
        setEditMsgBundle(null);
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
        setCreating(false);
        setSelectedId(result.id);
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
        closeDrawer();
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
        setAddingProduct(false);
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

  const columns: Column<Bundle>[] = [
    {
      key: "name",
      header: "Conjunto",
      cell: (b) => (
        <div className="flex items-center gap-3">
          <div className="section-icon w-9 h-9 shrink-0" style={{ background: "linear-gradient(135deg, rgba(177, 75, 255, 0.14) 0%, rgba(177, 75, 255, 0.04) 100%)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-foreground font-medium truncate">{b.ghost_name || b.name}</p>
            <p className="text-[10px] text-(--text-ghost) font-mono stat-value truncate">{b.id}</p>
          </div>
        </div>
      ),
    },
    {
      key: "products",
      header: "Produtos",
      align: "center",
      cell: (b) => (
        <span className="text-(--text-secondary) text-xs stat-value">
          {b.product_bundle_items.length} produto{b.product_bundle_items.length !== 1 ? "s" : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      secondary: true,
      cell: (b) =>
        b.is_active ? (
          <span className="badge badge-active">Ativo</span>
        ) : (
          <span className="badge badge-inactive">Inativo</span>
        ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Conjuntos"
        subtitle="agrupe produtos pro fluxo de pagamento"
        search={<CommandSearch value={search} onChange={setSearch} placeholder="Buscar conjunto..." />}
        kpis={<KpiPill label="conjuntos" value={bundles.length.toLocaleString("pt-BR")} accent="purple" />}
        action={
          <button onClick={() => { setCreating(true); setNewName(""); setNewMessage("Escolha um produto para comprar:"); }} className="btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo Conjunto
          </button>
        }
      />

      <div className="flex-1 p-4 sm:p-6">
        <div className="card overflow-hidden">
          <DataGrid
            columns={columns}
            rows={filtered}
            rowKey={(b) => b.id}
            onRowClick={(b) => { setSelectedId(b.id); setAddingProduct(false); setEditGhostBundle(null); setEditMsgBundle(null); }}
            selectedKey={selectedId}
            empty={search.trim() ? "Nenhum conjunto encontrado" : "Nenhum conjunto criado"}
          />
        </div>
      </div>

      {/* Create drawer */}
      <ContextDrawer
        open={creating}
        onClose={() => setCreating(false)}
        title="Novo Conjunto"
        subtitle="criar conjunto"
      >
        <div className="space-y-4">
          <div>
            <label className="input-label">Nome do Conjunto</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Plano Premium" className="input" />
          </div>
          <div>
            <label className="input-label">Mensagem no Telegram</label>
            <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Escolha um produto para comprar:" rows={3} className="input text-sm w-full resize-y" />
            <p className="text-(--text-ghost) text-[10px] mt-1.5">Texto que aparece antes dos produtos no Telegram</p>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreate} disabled={isPending || !newName.trim()} className="btn-primary">Criar</button>
            <button onClick={() => setCreating(false)} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </ContextDrawer>

      {/* Detail / edit drawer */}
      <ContextDrawer
        open={!!selected}
        onClose={closeDrawer}
        title={selected ? selected.ghost_name || selected.name : "Conjunto"}
        subtitle={selected ? `${selected.product_bundle_items.length} produto${selected.product_bundle_items.length !== 1 ? "s" : ""}` : "detalhe do conjunto"}
        size="lg"
        actions={
          selected && (
            <button onClick={() => handleDelete(selected.id)} disabled={isPending} className="btn-danger py-1.5!">
              Excluir
            </button>
          )
        }
      >
        {selected && (
          <div className="space-y-6">
            {/* Detalhes — mensagem do Telegram */}
            <section>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-(--text-ghost) mb-3">Detalhes</p>
              <div className="card p-4 relative">
                {editMsgBundle === selected.id ? (
                  <div className="space-y-2">
                    <label className="input-label">Mensagem no Telegram (aparece antes dos produtos)</label>
                    <textarea
                      value={editMsgValue}
                      onChange={(e) => setEditMsgValue(e.target.value)}
                      placeholder="Escolha um produto para comprar:"
                      rows={3}
                      className="input text-sm w-full resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveMessage(selected.id)}
                        disabled={isPending}
                        className="btn-primary py-1.5! px-3 text-xs"
                      >
                        Salvar
                      </button>
                      <button
                        onClick={() => setEditMsgBundle(null)}
                        className="text-(--text-muted) hover:text-foreground text-xs px-2"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-(--text-muted) text-xs flex-1">
                      Mensagem: <span className="text-(--text-secondary) font-medium whitespace-pre-wrap">{selected.message_text}</span>
                    </p>
                    <button
                      onClick={() => {
                        setEditMsgValue(selected.message_text ?? "");
                        setEditMsgBundle(selected.id);
                      }}
                      className="text-(--accent) hover:underline text-xs shrink-0"
                    >
                      Editar
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Produtos do conjunto */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-(--text-ghost)">Produtos do conjunto</p>
                {!addingProduct && (
                  <button
                    onClick={() => setAddingProduct(true)}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all"
                    style={{ background: "color-mix(in srgb, var(--purple) 10%, transparent)", color: "var(--purple)" }}
                  >
                    + Adicionar Produto
                  </button>
                )}
              </div>

              {selected.product_bundle_items.length > 0 ? (
                <div className="space-y-2">
                  {selected.product_bundle_items
                    .slice()
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold stat-value shrink-0" style={{ background: "color-mix(in srgb, var(--purple) 12%, transparent)", color: "var(--purple)" }}>
                            {item.sort_order + 1}
                          </span>
                          <span className="text-foreground text-sm font-medium truncate">{item.products.ghost_name || item.products.name}</span>
                          <span className="text-(--accent) text-xs stat-value shrink-0">
                            {(item.products.price / 100).toLocaleString("pt-BR", { style: "currency", currency: item.products.currency })}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveProduct(selected.id, item.id)}
                          disabled={isPending}
                          className="text-(--red)/50 hover:text-(--red) text-xs font-medium transition-colors shrink-0"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-(--text-ghost) text-xs">Nenhum produto neste conjunto</p>
              )}

              {addingProduct && (() => {
                const availableProducts = products.filter(
                  (p) => p.is_active && !selected.product_bundle_items.some((bp) => bp.product_id === p.id),
                );
                return (
                  <div className="space-y-2 mt-3 pt-3 border-t border-(--border-subtle)">
                    <p className="text-(--text-secondary) text-xs font-semibold uppercase tracking-wider">Selecione um produto:</p>
                    {availableProducts.length === 0 ? (
                      <p className="text-(--text-ghost) text-xs">Todos os produtos ja estao neste conjunto</p>
                    ) : (
                      <div className="space-y-1">
                        {availableProducts.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleAddProduct(selected.id, p.id)}
                            disabled={isPending}
                            className="w-full text-left px-4 py-3 rounded-xl text-sm text-foreground transition-all flex items-center justify-between group/item"
                            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}
                          >
                            <span className="group-hover/item:text-(--accent) transition-colors truncate">{p.ghost_name || p.name}</span>
                            <span className="text-(--accent) text-xs stat-value shrink-0">
                              {(p.price / 100).toLocaleString("pt-BR", { style: "currency", currency: p.currency })}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => setAddingProduct(false)} className="text-(--text-muted) text-xs hover:text-(--text-secondary) transition-colors font-medium">
                      Cancelar
                    </button>
                  </div>
                );
              })()}
            </section>

            {/* Avançado — Fantasma (admin) */}
            {isAdmin && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-(--text-ghost) mb-3">Avançado</p>
                <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge badge-error text-[10px]">FANTASMA</span>
                    <span className="text-(--text-muted) text-[10px]">Enviado pro Facebook (ViewContent) no lugar do nome real. Fallback pro nome se vazio.</span>
                  </div>
                  {editGhostBundle === selected.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editGhostValue}
                        onChange={(e) => setEditGhostValue(e.target.value)}
                        placeholder="Nome fantasma do conjunto"
                        className="input text-sm flex-1"
                      />
                      <button
                        onClick={() => handleSaveGhost(selected.id)}
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
                        {selected.ghost_name ? (
                          <>FANTASMA: <span className="text-red-300 font-medium">{selected.ghost_name}</span></>
                        ) : (
                          <span className="text-(--text-ghost) italic">Nenhum nome fantasma (FB recebe o nome real)</span>
                        )}
                      </span>
                      <button
                        onClick={() => {
                          setEditGhostValue(selected.ghost_name ?? "");
                          setEditGhostBundle(selected.id);
                        }}
                        className="text-(--accent) hover:underline text-xs"
                      >
                        {selected.ghost_name ? "Editar" : "Definir"}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </ContextDrawer>
    </div>
  );
}
