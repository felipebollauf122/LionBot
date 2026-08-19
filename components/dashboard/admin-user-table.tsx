"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminUser } from "@/lib/actions/admin-actions";
import { updateUserRole, updateUserPremium } from "@/lib/actions/admin-actions";

interface AdminUserTableProps {
  users: AdminUser[];
}

function formatCurrency(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function AdminUserTable({ users: initialUsers }: AdminUserTableProps) {
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [premiumFilter, setPremiumFilter] = useState<"all" | "premium" | "not_premium">("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingPremiumId, setUpdatingPremiumId] = useState<string | null>(null);
  const router = useRouter();

  const filtered = users.filter((u) => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    const matchPremium = premiumFilter === "all" || (premiumFilter === "premium" ? u.is_premium : !u.is_premium);
    return matchSearch && matchRole && matchPremium;
  });

  const handleRoleChange = async (userId: string, newRole: "user" | "admin") => {
    setUpdatingId(userId);
    try {
      await updateUserRole(userId, newRole);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar role");
    } finally {
      setUpdatingId(null);
    }
  };

  const handlePremiumChange = async (userId: string, newIsPremium: boolean) => {
    setUpdatingPremiumId(userId);
    try {
      await updateUserPremium(userId, newIsPremium);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, is_premium: newIsPremium } : u));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar premium");
    } finally {
      setUpdatingPremiumId(null);
    }
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "admin", "user"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setRoleFilter(f)}
              className={`toggle-btn ${roleFilter === f ? "on" : "off"}`}
            >
              {f === "all" ? "Todos" : f === "admin" ? "Admins" : "Usuarios"}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["all", "premium", "not_premium"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setPremiumFilter(f)}
              className={`toggle-btn ${premiumFilter === f ? "on" : "off"}`}
            >
              {f === "all" ? "Todos" : f === "premium" ? "Premium" : "Nao Premium"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Usuario</th>
                <th className="table-header">Role</th>
                <th className="table-header">Premium</th>
                <th className="table-header">Plano</th>
                <th className="table-header">Bots</th>
                <th className="table-header">Leads</th>
                <th className="table-header">Vendas</th>
                <th className="table-header">Receita</th>
                <th className="table-header">Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr
                  key={user.id}
                  className="cursor-pointer hover:bg-white/[0.02] transition"
                  onClick={() => router.push(`/dashboard/admin/users/${user.id}`)}
                >
                  <td className="table-cell">
                    <div>
                      <p className="text-foreground text-sm font-medium">{user.name || "Sem nome"}</p>
                      <p className="text-(--text-muted) text-xs">{user.email}</p>
                    </div>
                  </td>
                  <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as "user" | "admin")}
                      disabled={updatingId === user.id}
                      className="input py-1.5! px-2! text-xs! w-24! rounded-lg!"
                    >
                      <option value="user">Usuario</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handlePremiumChange(user.id, !user.is_premium)}
                      disabled={updatingPremiumId === user.id}
                      className={`toggle-btn ${user.is_premium ? "on" : "off"}`}
                    >
                      {user.is_premium ? "Sim" : "Nao"}
                    </button>
                  </td>
                  <td className="table-cell">
                    <span className="badge badge-info">{user.plan ?? "Free"}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-foreground text-sm stat-value">{user.bots_active}</span>
                    <span className="text-(--text-muted) text-xs">/{user.bots_total}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-foreground text-sm stat-value">{user.leads_total}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-foreground text-sm stat-value">{user.transactions_total}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-(--accent) text-sm font-semibold stat-value">{formatCurrency(user.revenue_total)}</span>
                  </td>
                  <td className="table-cell">
                    <span className="text-(--text-secondary) text-xs">{formatDate(user.created_at)}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="table-cell text-center text-(--text-muted) py-12!">
                    Nenhum usuario encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
