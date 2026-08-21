"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminUser, AdminBot, ViewableUser } from "@/lib/actions/admin-actions";
import { updateUserRole, updateUserPremium } from "@/lib/actions/admin-actions";
import { TransferBotModal, type TransferSummary } from "@/components/dashboard/transfer-bot-modal";
import { summarizeMoved } from "@/lib/transfer-summary";

interface AdminUserProfileProps {
  user: AdminUser;
  bots: AdminBot[];
  /** Destinos possíveis numa transferência de bot (getViewableUsers). */
  users: ViewableUser[];
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function AdminUserProfile({ user: initialUser, bots: initialBots, users }: AdminUserProfileProps) {
  const [user, setUser] = useState(initialUser);
  const [bots, setBots] = useState(initialBots);
  const [updatingRole, setUpdatingRole] = useState(false);
  const [updatingPremium, setUpdatingPremium] = useState(false);
  const [transferBot, setTransferBot] = useState<AdminBot | null>(null);
  const [transferred, setTransferred] = useState<TransferSummary | null>(null);
  const router = useRouter();

  const handleTransferred = (summary: TransferSummary) => {
    const gone = transferBot;
    if (!gone) return;

    // O bot deixou de ser deste usuário: tira da tabela na hora em vez de
    // esperar o refresh, senão o "Gerenciar" da linha abriria uma rota
    // /users/<dono antigo>/bots/<bot> que o layout já rejeita (o layout filtra
    // por .eq("tenant_id", userId) e daria 404).
    setBots((prev) => prev.filter((b) => b.id !== gone.id));

    // Os cards do topo também precisam descontar o bot na mão. `user` nasce de
    // useState(initialUser), e o initializer NÃO roda de novo quando o
    // router.refresh() traz props novas — sem isto, os cards ficariam com os
    // números de antes ("Bots 3/3", "Leads 500") contradizendo o cabeçalho da
    // tabela logo abaixo ("Bots (2)") até um reload completo da página.
    setUser((prev) => ({
      ...prev,
      bots_total: Math.max(0, prev.bots_total - 1),
      bots_active: Math.max(0, prev.bots_active - (gone.is_active ? 1 : 0)),
      leads_total: Math.max(0, prev.leads_total - gone.leads_count),
      transactions_total: Math.max(0, prev.transactions_total - gone.transactions_count),
      revenue_total: Math.max(0, prev.revenue_total - gone.revenue),
    }));

    setTransferBot(null);
    setTransferred(summary);
    router.refresh();
  };

  const handleRoleChange = async (newRole: "user" | "admin") => {
    setUpdatingRole(true);
    try {
      await updateUserRole(user.id, newRole);
      setUser((prev) => ({ ...prev, role: newRole }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar role");
    } finally {
      setUpdatingRole(false);
    }
  };

  const handlePremiumChange = async (newIsPremium: boolean) => {
    setUpdatingPremium(true);
    try {
      await updateUserPremium(user.id, newIsPremium);
      setUser((prev) => ({ ...prev, is_premium: newIsPremium }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar premium");
    } finally {
      setUpdatingPremium(false);
    }
  };

  const stats = [
    { label: "Bots", value: `${user.bots_active}/${user.bots_total}`, color: "var(--accent)" },
    { label: "Leads", value: user.leads_total.toString(), color: "var(--cyan)" },
    { label: "Vendas", value: user.transactions_total.toString(), color: "var(--purple)" },
    { label: "Receita", value: formatCurrency(user.revenue_total), color: "var(--accent)" },
  ];

  return (
    <div>
      {/* Back link */}
      <a
        href="/dashboard/admin/users"
        className="inline-flex items-center gap-2 text-(--text-muted) text-sm hover:text-foreground transition mb-6"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Voltar
      </a>

      {/* User header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold"
              style={{
                background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 15%, transparent), color-mix(in srgb, var(--cyan) 10%, transparent))",
                color: "var(--accent)",
              }}
            >
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground page-title">{user.name || "Sem nome"}</h2>
              <p className="text-(--text-secondary) text-sm">{user.email}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="badge badge-info">{user.plan ?? "Free"}</span>
                <span className="text-(--text-muted) text-xs">Desde {formatDate(user.created_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div>
              <label className="input-label">Role</label>
              <select
                value={user.role}
                onChange={(e) => handleRoleChange(e.target.value as "user" | "admin")}
                disabled={updatingRole}
                className="input py-2! px-3! text-sm! w-32!"
              >
                <option value="user">Usuario</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="input-label">Premium</label>
              <div>
                <button
                  onClick={() => handlePremiumChange(!user.is_premium)}
                  disabled={updatingPremium}
                  className={`toggle-btn ${user.is_premium ? "on" : "off"}`}
                >
                  {user.is_premium ? "Sim" : "Nao"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="card p-5 relative top-glow">
            <p className="text-(--text-muted) text-xs font-semibold uppercase tracking-wider mb-1">{s.label}</p>
            <p className="text-xl font-bold stat-value text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Resultado da última transferência */}
      {transferred && (
        <div
          className="card p-4 mb-6"
          // borderColor inline: `.card` mora fora de qualquer @layer no
          // globals.css e as utilities do Tailwind v4 vêm dentro de
          // @layer utilities — regra sem layer sempre ganha da com layer,
          // então um `border-(--accent)/25` aqui não pintaria nada.
          style={{
            background: "var(--accent-deep)",
            borderColor: "color-mix(in srgb, var(--accent) 25%, transparent)",
          }}
          role="status"
        >
          <p className="text-foreground text-sm font-semibold">
            @{transferred.botUsername} agora é de {transferred.toName}.
          </p>
          <p className="text-(--text-muted) text-xs mt-1">
            Foram junto: {summarizeMoved(transferred.moved)}.
          </p>
          {!transferred.cacheInvalidated && (
            <p className="text-(--amber) text-xs mt-2">
              O servidor do bot não confirmou a limpeza do cache — a troca já está no banco, mas o bot
              pode levar até 10 minutos pra enxergar o novo dono.
            </p>
          )}
        </div>
      )}

      {/* Bots */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <h3 className="text-foreground font-semibold text-sm">Bots ({bots.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Bot</th>
                <th className="table-header">Status</th>
                <th className="table-header">Leads</th>
                <th className="table-header">Receita</th>
                <th className="table-header">Criado</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody>
              {bots.map((bot) => (
                <tr key={bot.id} className="hover:bg-white/[0.02] transition">
                  <td className="table-cell">
                    <span className="text-foreground text-sm font-medium">@{bot.bot_username}</span>
                  </td>
                  <td className="table-cell">
                    <span className={`badge ${bot.is_active ? "badge-active" : "badge-inactive"}`}>
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${bot.is_active ? "bg-(--accent)" : "bg-(--text-ghost)"}`} />
                      {bot.is_active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className="text-foreground text-sm stat-value">{bot.leads_count}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-(--accent) text-sm font-semibold stat-value">{formatCurrency(bot.revenue)}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-(--text-secondary) text-xs">{formatDate(bot.created_at)}</span>
                  </td>
                  <td className="table-cell text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setTransferBot(bot)}
                        className="btn-ghost py-1.5! px-3! text-xs!"
                        title="Passar este bot para outro usuário"
                      >
                        Transferir
                      </button>
                      <a
                        href={`/dashboard/admin/users/${user.id}/bots/${bot.id}/flows`}
                        className="btn-ghost py-1.5! px-3! text-xs!"
                      >
                        Gerenciar
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {bots.length === 0 && (
                <tr>
                  <td colSpan={6} className="table-cell text-center text-(--text-muted) py-12!">
                    Nenhum bot encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {transferBot && (
        <TransferBotModal
          botId={transferBot.id}
          botUsername={transferBot.bot_username}
          currentOwner={{ id: user.id, name: user.name || user.email, email: user.email }}
          users={users}
          onClose={() => setTransferBot(null)}
          onTransferred={handleTransferred}
        />
      )}
    </div>
  );
}
