"use client";

import { useState, useTransition } from "react";
import { saveAutomationBot, removeAutomationBot } from "@/app/dashboard/automations/clones/actions";

export function AutomationBotCard({
  bot,
}: {
  bot: { username: string; bot_user_id: string } | null;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (bot) {
    return (
      <div className="card-glow reveal p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="section-icon w-10 h-10 shrink-0 text-lg"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent) 0%, color-mix(in srgb, var(--accent) 4%, transparent) 100%)",
              boxShadow: "0 0 14px -4px var(--accent)",
            }}
          >
            🤖
          </div>
          <div className="min-w-0">
            <div className="text-(--text-primary) font-medium truncate">@{bot.username}</div>
            <div className="text-(--text-secondary) text-sm mt-0.5">
              Publica os clones e é promovido a admin nos destinos criados.
            </div>
          </div>
        </div>
        <button
          onClick={() => start(() => void removeAutomationBot())}
          disabled={pending}
          className="btn-ghost text-xs px-3 py-1.5 shrink-0"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="card reveal p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div
          className="section-icon w-10 h-10 shrink-0 text-lg"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent) 0%, color-mix(in srgb, var(--accent) 4%, transparent) 100%)",
            boxShadow: "0 0 14px -4px var(--accent)",
          }}
        >
          🤖
        </div>
        <div className="text-(--text-primary) font-medium">Bot companheiro</div>
      </div>
      <p className="text-(--text-secondary) text-sm">
        Crie um bot no @BotFather e cole o token. Ele é quem publica os clones — sua
        conta pessoal só lê. No BotFather, deixe <strong>Group Privacy desligado</strong> e{" "}
        <strong>allow groups ligado</strong>, senão a promoção a admin falha.
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
            const res = await saveAutomationBot(token);
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
