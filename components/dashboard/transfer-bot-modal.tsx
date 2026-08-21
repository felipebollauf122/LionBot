"use client";

/**
 * Modal de transferência de posse de bot (área admin).
 *
 * Mesma anatomia dos outros modais do painel (bot-clone-risk-modal.tsx,
 * traffic-filter-manager.tsx): overlay com blur, fecha clicando fora ou no Esc,
 * role="dialog". A diferença é a cor — aqui não é ação de risco, é ação
 * consequente: usa o accent do tema, não o vermelho de perigo. E as cores saem
 * todas de var() porque o painel tem mais de um tema (globals.css:80+).
 */

import { useEffect, useRef, useState } from "react";
import { transferBotOwner } from "@/lib/actions/admin-actions";
import type { ViewableUser } from "@/lib/actions/admin-actions";

interface TransferBotModalProps {
  botId: string;
  botUsername: string;
  /** Dono atual — some da lista de destinos e aparece no "de → para". */
  currentOwner: { id: string; name: string; email: string };
  /** Todos os usuários da plataforma (getViewableUsers). */
  users: ViewableUser[];
  onClose: () => void;
  /** Chamado só depois de uma transferência que realmente aconteceu. */
  onTransferred: (summary: TransferSummary) => void;
}

export interface TransferSummary {
  botUsername: string;
  toName: string;
  moved: Record<string, number>;
  cacheInvalidated: boolean;
}

export function TransferBotModal({
  botId,
  botUsername,
  currentOwner,
  users,
  onClose,
  onTransferred,
}: TransferBotModalProps) {
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Esc fecha — mas não no meio da transferência: o banco já pode estar
  // mudando de dono, e sumir com o modal daria a impressão de ter cancelado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !transferring) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, transferring]);

  const term = search.trim().toLowerCase();
  const candidates = users
    .filter((u) => u.id !== currentOwner.id)
    .filter((u) => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));

  const target = users.find((u) => u.id === targetId) ?? null;

  const handleConfirm = async () => {
    if (!target) return;
    setTransferring(true);
    setError(null);
    try {
      const result = await transferBotOwner(botId, target.id);

      // Recusa prevista (não é admin, bot de login MTProto, clonagem pendente)
      // volta como dado, com a mensagem já em português — ver o comentário em
      // transferBotOwner sobre o Next apagar mensagem de erro em produção.
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (!result.changed) {
        setError(`@${botUsername} já é de ${target.name}.`);
        return;
      }
      onTransferred({
        botUsername: result.botUsername || botUsername,
        toName: target.name,
        moved: result.moved,
        cacheInvalidated: result.cacheInvalidated,
      });
    } catch (err) {
      // Só cai aqui em falha de rede/serialização — as recusas conhecidas
      // vieram como `ok: false` acima.
      setError(err instanceof Error ? err.message : "Erro ao transferir o bot");
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-bot-title"
      onClick={() => {
        if (!transferring) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-(--border-default) overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          background: "linear-gradient(160deg, var(--bg-overlay) 0%, var(--bg-surface) 100%)",
          boxShadow: "0 24px 80px -20px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="absolute top-0 left-6 right-6 h-px"
          style={{ background: "linear-gradient(to right, transparent, var(--accent), transparent)" }}
        />

        <div className="p-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "var(--accent-muted)", boxShadow: "0 0 24px -6px var(--accent)" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" />
              <path d="M21 3l-7 7" />
              <path d="M8 21H3v-5" />
              <path d="M3 21l7-7" />
            </svg>
          </div>

          <h2 id="transfer-bot-title" className="text-foreground font-bold text-lg tracking-tight">
            Transferir @{botUsername}
          </h2>
          <p className="text-(--text-muted) text-xs mt-1">
            Sai de <b className="text-(--text-secondary)">{currentOwner.name}</b> e passa a ser do usuário escolhido.
          </p>

          {/* Destino */}
          <div className="mt-5">
            <label className="input-label" htmlFor="transfer-bot-search">
              Novo dono
            </label>
            <input
              id="transfer-bot-search"
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou e-mail…"
              disabled={transferring}
              className="input py-2! text-sm!"
            />

            <div
              className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-(--border-subtle)"
              role="listbox"
              aria-label="Usuários de destino"
            >
              {candidates.map((u) => {
                const selected = u.id === targetId;
                return (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={transferring}
                    onClick={() => setTargetId(u.id)}
                    className={`w-full text-left px-3 py-2.5 transition-colors border-b border-(--border-subtle) last:border-b-0 ${
                      selected ? "bg-(--accent-muted)" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="block text-foreground text-sm font-medium truncate">{u.name}</span>
                    <span className="block text-(--text-muted) text-xs truncate">{u.email}</span>
                  </button>
                );
              })}
              {candidates.length === 0 && (
                <p className="px-3 py-6 text-center text-(--text-muted) text-xs">
                  Nenhum outro usuário encontrado.
                </p>
              )}
            </div>
          </div>

          {/* O que acontece */}
          <div
            className="mt-4 rounded-xl p-3 border border-(--border-subtle)"
            style={{ background: "var(--accent-deep)" }}
          >
            <p className="text-(--text-secondary) text-xs leading-relaxed">
              Vão junto: <b className="text-foreground">leads, vendas, fluxos, produtos, tracking, remarketing,
              mensagens e mídias</b> desse bot. As notificações de venda e as análises passam a cair na conta do
              novo dono.
            </p>
            <p className="text-(--text-muted) text-xs leading-relaxed mt-2">
              Ficam com o dono antigo: as <b className="text-(--text-secondary)">regras do filtro de tráfego</b>{" "}
              (são da conta, não do bot — recadastre no novo dono se o bot usava alguma) e as contas de
              automação/MTProto.
            </p>
          </div>

          {error && (
            <p
              className="mt-4 rounded-xl px-3 py-2.5 text-xs border border-(--red)/25 text-(--red)"
              style={{ background: "var(--red-muted)" }}
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={transferring}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-foreground border border-(--border-default) hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!target || transferring}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)",
                boxShadow: "0 8px 24px -8px var(--accent-glow)",
              }}
            >
              {transferring ? "Transferindo…" : target ? `Transferir para ${target.name}` : "Escolha o novo dono"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
