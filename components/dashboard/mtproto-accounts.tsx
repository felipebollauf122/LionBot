"use client";

import { useState, useTransition, useEffect } from "react";
import {
  startAddAccount,
  submitAuthCode,
  submitAuthPassword,
  removeAccount,
  syncAccountDialogs,
} from "@/app/dashboard/automations/actions";
import { clearAccountRestriction } from "@/app/dashboard/automations/clones/actions";
import { createClient } from "@/lib/supabase/client";

interface Account {
  id: string;
  phone_number: string;
  display_name: string | null;
  status: string;
  last_error: string | null;
  create_restricted?: boolean;
}

export function MtprotoAccounts({
  accounts,
  actingTenantId,
}: {
  accounts: Account[];
  /** Tenant pra quem criar uma conta nova (visão admin "Usuário"). Undefined = próprio usuário logado, ou "Conectar conta" desabilitado em "Todos". */
  actingTenantId?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"form" | "code" | "password">("form");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!pendingAccountId) return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("mtproto_accounts")
        .select("status,last_error")
        .eq("id", pendingAccountId)
        .single();
      if (!data) return;
      if (data.status === "code_sent" && step === "form") setStep("code");
      if (data.status === "needs_password") setStep("password");
      if (data.status === "active") {
        clearInterval(interval);
        setAdding(false);
        setPendingAccountId(null);
        setStep("form");
        setPhone("");
        setName("");
        setCode("");
        setPassword("");
        window.location.reload();
      }
      if (data.last_error) setError(data.last_error);
    }, 1200);
    return () => clearInterval(interval);
  }, [pendingAccountId, step]);

  function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const { accountId } = await startAddAccount(phone, name, actingTenantId);
        setPendingAccountId(accountId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "erro");
      }
    });
  }

  function submitCodeStep(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingAccountId) return;
    startTransition(async () => {
      try {
        await submitAuthCode(pendingAccountId, code);
      } catch (err) {
        setError(err instanceof Error ? err.message : "erro");
      }
    });
  }

  function submitPasswordStep(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingAccountId) return;
    startTransition(async () => {
      try {
        await submitAuthPassword(pendingAccountId, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : "erro");
      }
    });
  }

  return (
    <div className="space-y-1.5">
      {accounts.length === 0 && (
        <p className="py-6 text-center text-(--text-ghost) text-xs">Nenhuma conta conectada ainda.</p>
      )}
      {accounts.map((a) => (
        <div
          key={a.id}
          className="row-hover reveal flex flex-col gap-2.5 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-(--text-primary) text-sm font-medium">
              {a.display_name || a.phone_number}
            </span>
            {a.status === "active" ? (
              <span className="badge badge-active">ATIVO</span>
            ) : (
              <span className="badge badge-pending">{a.status.toUpperCase()}</span>
            )}
            <span className="text-(--text-muted) text-xs ml-auto whitespace-nowrap">
              {a.phone_number}
            </span>
          </div>
            {a.create_restricted && (
              <div className="flex items-center gap-2 mt-2">
                <span
                  className="badge badge-pending"
                  title="O Telegram limitou esta conta de criar canais (USER_RESTRICTED). Ela ainda lê e baixa, mas não cria destino de clone. Resolva no @SpamBot e depois libere aqui."
                >
                  ⚠ restrita — não cria canais
                </span>
                <button
                  onClick={() =>
                    startTransition(() =>
                      clearAccountRestriction(a.id).then(() => window.location.reload()),
                    )
                  }
                  className="btn-ghost text-xs px-3 py-1.5"
                >
                  marcar como liberada
                </button>
              </div>
            )}
            {a.last_error && (
              <div className="text-(--red) text-xs">{a.last_error}</div>
            )}
          <div className="flex flex-wrap gap-2 mt-1">
            {a.status === "active" && (
              <>
                <a
                  href={`/dashboard/automations/accounts/${a.id}/inbox`}
                  className="btn-ghost text-xs px-3 py-1.5"
                  title="Mensagens recebidas do Telegram oficial (códigos de login, alertas)"
                >
                  Mensagens
                </a>
                <button
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await syncAccountDialogs(a.id);
                        alert("Sincronização iniciada. Em alguns segundos seus contatos/grupos vão aparecer no formulário de campanha.");
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "erro");
                      }
                    })
                  }
                  className="btn-ghost text-xs px-3 py-1.5"
                  title="Sincroniza contatos, DMs, grupos e canais da conta — pode levar 10-30s em contas grandes"
                >
                  Sincronizar
                </button>
              </>
            )}
            <a
              href={`/dashboard/automations/accounts/${a.id}/dialogs`}
              className="btn-ghost text-xs px-3 py-1.5"
            >
              Ver conteúdo
            </a>
            <button
              onClick={() =>
                startTransition(() =>
                  removeAccount(a.id).then(() => window.location.reload()),
                )
              }
              className="btn-ghost text-xs px-3 py-1.5"
            >
              Remover
            </button>
          </div>
        </div>
      ))}

      {actingTenantId && !adding && (
        <button onClick={() => setAdding(true)} className="btn-ghost text-sm">
          + Conectar conta
        </button>
      )}

      {actingTenantId && adding && step === "form" && (
        <form onSubmit={submitPhone} className="rounded-lg bg-white/[0.02] border border-(--border-subtle) p-4 space-y-3">
          <div>
            <label className="input-label">Nome da conta</label>
            <input
              placeholder="Nome (ex: Conta principal)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="input-label">Telefone</label>
            <input
              placeholder="+5511999998888"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input"
            />
          </div>
          {error && <p className="text-(--red) text-xs">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">
              Pedir código
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="btn-ghost"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {adding && step === "code" && (
        <form onSubmit={submitCodeStep} className="rounded-lg bg-white/[0.02] border border-(--border-subtle) p-4 space-y-3">
          <p className="text-(--text-secondary) text-sm">
            Digite o código que chegou no seu Telegram:
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input"
          />
          {error && <p className="text-(--red) text-xs">{error}</p>}
          <button type="submit" className="btn-primary">
            Entrar
          </button>
        </form>
      )}

      {adding && step === "password" && (
        <form onSubmit={submitPasswordStep} className="rounded-lg bg-white/[0.02] border border-(--border-subtle) p-4 space-y-3">
          <p className="text-(--text-secondary) text-sm">Sua conta tem 2FA — digite a senha:</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          {error && <p className="text-(--red) text-xs">{error}</p>}
          <button type="submit" className="btn-primary">
            Entrar
          </button>
        </form>
      )}
    </div>
  );
}
