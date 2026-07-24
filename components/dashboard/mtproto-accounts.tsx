"use client";

import { useState, useTransition, useEffect } from "react";
import {
  startAddAccount,
  submitAuthCode,
  submitAuthPassword,
  removeAccount,
  syncAccountDialogs,
} from "@/app/dashboard/automations/actions";
import { createClient } from "@/lib/supabase/client";

interface Account {
  id: string;
  phone_number: string;
  display_name: string | null;
  status: string;
  last_error: string | null;
}

export function MtprotoAccounts({ accounts }: { accounts: Account[] }) {
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
        const { accountId } = await startAddAccount(phone, name);
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
    <div className="space-y-3">
      {accounts.length === 0 && (
        <p className="text-white/40 text-sm">Nenhuma conta conectada ainda.</p>
      )}
      {accounts.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/[0.02]"
        >
          <div>
            <div className="text-white text-sm font-medium">
              {a.display_name || a.phone_number}
            </div>
            <div className="text-white/40 text-xs">
              {a.phone_number} · {a.status}
            </div>
            {a.last_error && (
              <div className="text-red-400 text-xs mt-1">{a.last_error}</div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {a.status === "active" && (
              <>
                <a
                  href={`/dashboard/automations/accounts/${a.id}/inbox`}
                  className="text-(--accent) hover:underline text-xs"
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
                  className="text-(--accent) hover:underline text-xs"
                  title="Sincroniza contatos, DMs, grupos e canais da conta — pode levar 10-30s em contas grandes"
                >
                  Sincronizar contatos/grupos
                </button>
              </>
            )}
            <a
              href={`/dashboard/automations/accounts/${a.id}/dialogs`}
              className="text-white/40 hover:text-white text-xs"
            >
              Ver conteúdo
            </a>
            <button
              onClick={() =>
                startTransition(() =>
                  removeAccount(a.id).then(() => window.location.reload()),
                )
              }
              className="text-white/40 hover:text-red-400 text-xs"
            >
              Remover
            </button>
          </div>
        </div>
      ))}

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="px-3 py-1.5 rounded-md border border-white/15 text-white/80 text-sm hover:bg-white/5"
        >
          + Conectar conta
        </button>
      )}

      {adding && step === "form" && (
        <form
          onSubmit={submitPhone}
          className="p-4 rounded-lg border border-white/10 bg-white/[0.02] space-y-2"
        >
          <input
            placeholder="Nome (ex: Conta principal)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
          <input
            placeholder="+5511999998888"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1.5 rounded bg-(--accent) text-black text-sm">
              Pedir código
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="px-3 py-1.5 text-white/60 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {adding && step === "code" && (
        <form
          onSubmit={submitCodeStep}
          className="p-4 rounded-lg border border-white/10 bg-white/[0.02] space-y-2"
        >
          <p className="text-white/70 text-sm">
            Digite o código que chegou no seu Telegram:
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" className="px-3 py-1.5 rounded bg-(--accent) text-black text-sm">
            Entrar
          </button>
        </form>
      )}

      {adding && step === "password" && (
        <form
          onSubmit={submitPasswordStep}
          className="p-4 rounded-lg border border-white/10 bg-white/[0.02] space-y-2"
        >
          <p className="text-white/70 text-sm">Sua conta tem 2FA — digite a senha:</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" className="px-3 py-1.5 rounded bg-(--accent) text-black text-sm">
            Entrar
          </button>
        </form>
      )}
    </div>
  );
}
