"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { seedLoginBotFlow } from "@/lib/actions/flow-actions";

export function CreateBotForm({ isOwner = false }: { isOwner?: boolean }) {
  const [token, setToken] = useState("");
  const [isLoginBot, setIsLoginBot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!token.includes(":")) {
        throw new Error(
          "Token invalido. O token do Telegram Bot deve estar no formato 123456:ABC-DEF..."
        );
      }

      const response = await fetch(
        `https://api.telegram.org/bot${token}/getMe`
      );
      const data = await response.json();

      if (!data.ok) {
        throw new Error(
          "Token invalido. Verifique se o token esta correto e tente novamente."
        );
      }

      const botUsername = data.result.username;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Nao autenticado.");
      }

      const { data: insertedBot, error: insertError } = await supabase
        .from("bots")
        .insert({
          tenant_id: user.id,
          telegram_token: token,
          bot_username: botUsername,
          is_active: isLoginBot ? true : false,
          is_mtproto_login_bot: isLoginBot,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // Bot de login: ativa direto, semeia o flow editável dos templates e
      // registra webhook automaticamente.
      if (isLoginBot && insertedBot?.id) {
        await seedLoginBotFlow(insertedBot.id).catch((err) =>
          console.error("seedLoginBotFlow failed:", err),
        );
        const serverUrl = (
          process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001"
        ).replace(/\/+$/, "");
        await fetch(`${serverUrl}/api/bots/${insertedBot.id}/register-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }).catch(() => {});
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar bot.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-lg animate-up">
      {/* Back */}
      <a
        href="/dashboard"
        className="inline-flex items-center gap-2 text-(--text-muted) hover:text-foreground text-sm transition-all mb-8 group"
      >
        <div className="w-7 h-7 rounded-lg bg-white/4 flex items-center justify-center group-hover:bg-white/8 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </div>
        Voltar
      </a>

      <h1 className="text-2xl font-bold text-foreground tracking-tight page-title mb-2">
        Novo Bot
      </h1>
      <p className="text-(--text-secondary) text-sm mb-8">
        Conecte um bot do Telegram para comecar a automatizar vendas
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl border border-(--red)/15 text-(--red) text-sm animate-in flex items-center gap-3" style={{ background: "linear-gradient(135deg, var(--red-muted) 0%, rgba(255,59,107,0.04) 100%)" }}>
          <div className="w-5 h-5 rounded-full bg-(--red)/20 flex items-center justify-center shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </div>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="card p-6 relative">
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--cyan)/15 to-transparent" />
          <div className="flex items-center gap-3 mb-5">
            <div className="section-icon w-10 h-10" style={{ background: "linear-gradient(135deg, var(--cyan-muted) 0%, rgba(0,229,255,0.04) 100%)", boxShadow: "0 0 12px -4px var(--cyan-glow)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-foreground font-semibold text-sm tracking-tight">Token do Telegram</h2>
              <p className="text-(--text-muted) text-xs">Cole o token recebido do @BotFather</p>
            </div>
          </div>

          <input
            type="text"
            placeholder="123456789:ABCdefGhIjKlmNoPqRsTuVwXyZ"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            className="input font-mono text-sm"
          />
          <p className="text-(--text-muted) text-xs mt-3">
            Obtenha o token criando um bot com o{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--accent) hover:text-(--accent-hover) transition-colors font-medium"
            >
              @BotFather
            </a>{" "}
            no Telegram.
          </p>
        </div>

        {isOwner && (
          <div className="card p-5 border border-amber-500/20 bg-amber-500/5">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isLoginBot}
                onChange={(e) => setIsLoginBot(e.target.checked)}
                className="accent-amber-400 mt-1"
              />
              <div>
                <div className="text-foreground text-sm font-medium">
                  🔐 Bot de login MTProto
                </div>
                <div className="text-(--text-muted) text-xs mt-1 leading-relaxed">
                  Marque se esse bot é exclusivo pra <b>logar contas Telegram do cliente final</b> no painel.
                  Quando ativo, o bot não usa flow editor — ele tem uma UX dedicada (pede número,
                  código, senha 2FA) e a conta logada aparece em <i>Contas conectadas</i> deste tenant.
                </div>
              </div>
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !token}
          className="btn-primary w-full py-3!"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2.5">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Validando token...
            </span>
          ) : "Criar Bot"}
        </button>
      </form>
    </div>
  );
}
