"use client";

import { useState, useTransition } from "react";
import { getBlacklist, addToBlacklist, removeFromBlacklist } from "@/lib/actions/blacklist-actions";
import type { BlacklistUser } from "@/lib/types/database";

interface BlacklistManagerProps {
  botId: string;
  initialBlacklist: BlacklistUser[];
}

export function BlacklistManager({ botId, initialBlacklist }: BlacklistManagerProps) {
  const [list, setList] = useState(initialBlacklist);
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [telegramUserId, setTelegramUserId] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [note, setNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleAdd = () => {
    const uid = parseInt(telegramUserId, 10);
    if (!uid || isNaN(uid)) {
      setAddError("Telegram User ID deve ser um numero valido");
      return;
    }
    setAddError(null);
    startTransition(async () => {
      try {
        const entry = await addToBlacklist(
          botId,
          uid,
          username || null,
          firstName || null,
          note || undefined,
        );
        setList((prev) => {
          const filtered = prev.filter((x) => x.telegram_user_id !== uid);
          return [entry, ...filtered];
        });
        setTelegramUserId("");
        setUsername("");
        setFirstName("");
        setNote("");
        setShowAdd(false);
      } catch (e) {
        setAddError(e instanceof Error ? e.message : "Erro ao adicionar");
      }
    });
  };

  const handleRemove = (id: string) => {
    setRemoving(id);
    startTransition(async () => {
      try {
        await removeFromBlacklist(id);
        setList((prev) => prev.filter((x) => x.id !== id));
      } catch (e) {
        console.error(e);
      } finally {
        setRemoving(null);
      }
    });
  };

  return (
    <div className="card p-6 mb-5 relative">
      <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--red)/15 to-transparent" />

      <div className="flex items-center gap-3 mb-5">
        <div
          className="section-icon w-10 h-10"
          style={{
            background: "color-mix(in srgb, var(--red) 14%, transparent)",
            boxShadow: "0 0 12px -4px var(--red)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <div>
          <h2 className="text-foreground font-semibold text-sm tracking-tight">Blacklist</h2>
          <p className="text-(--text-muted) text-xs">
            Usuários ignorados pelo bot — não recebem mensagens, remarketing nem callbacks
          </p>
        </div>
      </div>

      {/* Add button */}
      {!showAdd && (
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 text-xs font-bold text-(--accent) border border-(--accent)/15 rounded-lg hover:bg-(--accent-muted) transition-all mb-4"
          style={{ background: "linear-gradient(135deg, var(--accent-muted) 0%, rgba(255,43,214,0.04) 100%)" }}
        >
          + Adicionar usuario
        </button>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="p-4 rounded-xl border border-(--border-subtle) mb-4" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="input-label">Telegram User ID *</label>
              <input
                type="text"
                value={telegramUserId}
                onChange={(e) => setTelegramUserId(e.target.value)}
                placeholder="123456789"
                className="input"
              />
            </div>
            <div>
              <label className="input-label">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                className="input"
              />
            </div>
            <div>
              <label className="input-label">Nome</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Nome do usuario"
                className="input"
              />
            </div>
            <div>
              <label className="input-label">Nota</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Motivo (opcional)"
                className="input"
              />
            </div>
          </div>
          {addError && <p className="text-(--red) text-xs mb-2">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={isPending}
              className="btn-primary py-2! px-4! text-xs!"
            >
              {isPending ? "Adicionando..." : "Adicionar"}
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddError(null); }}
              className="btn-ghost py-2! px-4! text-xs!"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {list.length === 0 ? (
        <p className="text-(--text-ghost) text-xs text-center py-4">Nenhum usuario na blacklist</p>
      ) : (
        <div className="space-y-2">
          {list.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between p-3 rounded-xl border border-(--border-subtle) group hover:bg-white/2 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="section-icon w-8 h-8 shrink-0"
                  style={{ background: "color-mix(in srgb, var(--red) 10%, transparent)" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-sm font-medium truncate">
                      {entry.first_name || "Sem nome"}
                    </span>
                    {entry.username && (
                      <span className="text-(--text-muted) text-xs">@{entry.username}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-(--text-ghost) text-xs font-mono">{entry.telegram_user_id}</span>
                    {entry.note && (
                      <span className="text-(--text-ghost) text-xs"> — {entry.note}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleRemove(entry.id)}
                disabled={removing === entry.id}
                className="px-3 py-1.5 text-xs font-bold text-(--red) border border-(--red)/15 rounded-lg hover:bg-(--red-muted) transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50 shrink-0"
                style={{ background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)" }}
              >
                {removing === entry.id ? "..." : "Remover"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
