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
      <div className="p-4 rounded-lg border border-white/10 bg-white/[0.02] flex items-center justify-between">
        <div>
          <div className="text-white font-medium">🤖 @{bot.username}</div>
          <div className="text-white/50 text-xs mt-1">
            Publica os clones e é promovido a admin nos destinos criados.
          </div>
        </div>
        <button
          onClick={() => start(() => void removeAutomationBot())}
          disabled={pending}
          className="text-white/40 hover:text-red-400 text-xs"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
      <div className="text-white font-medium">🤖 Bot companheiro</div>
      <p className="text-white/50 text-xs">
        Crie um bot no @BotFather e cole o token. Ele é quem publica os clones — sua
        conta pessoal só lê. No BotFather, deixe <strong>Group Privacy desligado</strong> e{" "}
        <strong>allow groups ligado</strong>, senão a promoção a admin falha.
      </p>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="123456789:AAF-xxxxxxxxxxxxxxxxxxxxx"
        className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
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
        className="px-3 py-1.5 rounded bg-(--accent) text-black text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Validando..." : "Salvar bot"}
      </button>
    </div>
  );
}
