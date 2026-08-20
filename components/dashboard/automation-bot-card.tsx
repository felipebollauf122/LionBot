"use client";

import { useState, useTransition } from "react";
import { saveAutomationBot, removeAutomationBot } from "@/app/dashboard/automations/clones/actions";

// Renderiza SÓ o conteúdo — a page envolve num CardShell "Bot companheiro"
// (com o ícone do bot), então aqui não há card externo nem título duplicado.
export function AutomationBotCard({
  bot,
  createTenantId,
}: {
  bot: { username: string; bot_user_id: string; tenant_id: string } | null;
  /** Tenant pra quem criar o bot quando ainda não existe (visão admin "Usuário"). Undefined = próprio usuário logado, ou desabilitado em "Todos". */
  createTenantId?: string;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (bot) {
    return (
      <div className="row-hover reveal flex items-center justify-between gap-3 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
        <div className="min-w-0">
          <div className="text-foreground font-medium truncate">@{bot.username}</div>
          <div className="text-(--text-secondary) text-xs mt-0.5">
            Publica os clones e é promovido a admin nos destinos criados.
          </div>
        </div>
        <button
          onClick={() => start(() => void removeAutomationBot(bot.tenant_id))}
          disabled={pending}
          className="btn-ghost text-xs px-3 py-1.5 shrink-0 disabled:opacity-40"
        >
          Trocar
        </button>
      </div>
    );
  }

  if (!createTenantId) {
    return (
      <p className="py-6 text-center text-(--text-ghost) text-xs">
        Nenhum bot companheiro cadastrado por este usuário.
      </p>
    );
  }

  return (
    <div className="space-y-3 reveal">
      <p className="text-(--text-secondary) text-sm">
        Crie um bot no @BotFather e cole o token. Ele é quem publica os clones — sua conta
        pessoal só lê. No BotFather, deixe <strong className="text-foreground">Group Privacy
        desligado</strong> e <strong className="text-foreground">allow groups ligado</strong>,
        senão a promoção a admin falha.
      </p>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="123456789:AAF-xxxxxxxxxxxxxxxxxxxxx"
        className="input"
      />
      {error && <p className="text-(--red) text-xs">{error}</p>}
      <button
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await saveAutomationBot(token, createTenantId);
            if (!res.ok) setError(res.error);
            else setToken("");
          })
        }
        disabled={pending}
        className="btn-primary"
      >
        {pending ? "Validando..." : "Salvar bot"}
      </button>
    </div>
  );
}
