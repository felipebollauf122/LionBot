"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBotCloneJob, launchBotCloneJob } from "@/app/dashboard/automations/botclones/actions";
import { BotCloneRiskModal } from "@/components/dashboard/bot-clone-risk-modal";

export function BotCloneForm({
  destBots,
  accounts,
  actingTenantId,
}: {
  /** Bots do próprio tenant — pra qual deles o fluxo descoberto vai ser clonado. */
  destBots: Array<{ id: string; label: string }>;
  /** Contas MTProto ativas que podem conversar com o bot-alvo. */
  accounts: Array<{ id: string; label: string }>;
  actingTenantId?: string;
}) {
  const router = useRouter();
  const [targetBotUsername, setTargetBotUsername] = useState("");
  const [destBotId, setDestBotId] = useState(destBots[0]?.id ?? "");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [mode, setMode] = useState<"full" | "remarketing_only">("full");
  const [includeMedia, setIncludeMedia] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxDepth, setMaxDepth] = useState("40");
  const [maxNodes, setMaxNodes] = useState("500");
  const [clickThrottleMs, setClickThrottleMs] = useState("3000");
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const canSubmit = targetBotUsername.trim().length > 0 && !!destBotId && !!accountId;

  function handleConfirm() {
    start(async () => {
      setError(null);
      const res = await createBotCloneJob({
        targetBotUsername,
        destBotId,
        accountId,
        maxDepth: Number(maxDepth) || 40,
        maxNodes: Number(maxNodes) || 500,
        clickThrottleMs: Number(clickThrottleMs) || 3000,
        mode,
        includeMedia,
        actingTenantId,
      });
      if (!res.ok) {
        setShowRiskModal(false);
        setError(res.error);
        return;
      }
      // launchBotCloneJob lança (throw) se o bot-server estiver fora do ar. O
      // job "draft" já foi criado no banco, então mesmo se isso falhar a gente
      // navega pra tela de progresso: lá o usuário vê o status real (inclusive
      // last_error) e pode tentar de novo, em vez de travar o formulário.
      try {
        await launchBotCloneJob(res.cloneJobId);
      } catch {
        // Ignorado de propósito: a tela de progresso é quem reporta a falha.
      }
      setShowRiskModal(false);
      router.push(`/dashboard/automations/botclones/${res.cloneJobId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="input-label">Modo</span>
        <div className="mt-1 inline-flex gap-1 p-1 rounded-lg bg-white/[0.02] border border-(--border-subtle)">
          <button
            type="button"
            onClick={() => setMode("full")}
            className={`toggle-btn ${mode === "full" ? "on" : "off"}`}
          >
            Clonar fluxo completo
          </button>
          <button
            type="button"
            onClick={() => setMode("remarketing_only")}
            className={`toggle-btn ${mode === "remarketing_only" ? "on" : "off"}`}
          >
            Clonar apenas remarketing
          </button>
        </div>
        {mode === "remarketing_only" && (
          <span className="block text-(--text-muted) text-xs mt-2">
            Esse modo funciona melhor quando a conta escolhida já tem histórico real de conversa
            com o bot-alvo (por exemplo, reaproveitando a mesma conta de uma clonagem completa
            anterior nesse mesmo alvo, depois de deixá-la parada tempo suficiente pro remarketing
            do próprio bot-alvo chegar nessa conversa). Sem esse histórico, nada é capturado.
          </span>
        )}
      </div>

      <label className="row-hover flex items-start gap-3 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle) cursor-pointer">
        <input
          type="checkbox"
          checked={includeMedia}
          onChange={(e) => setIncludeMedia(e.target.checked)}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-foreground text-sm">Incluir mídia</span>
          <span className="block text-(--text-muted) text-xs mt-0.5">
            Desmarcar pula o download/reenvio de fotos e vídeos do bot clonado (mais rápido, mas
            as mensagens clonadas chegam sem mídia até você anexar algo manualmente — por exemplo,
            da biblioteca de mídia).
          </span>
        </span>
      </label>

      <label className="block">
        <span className="input-label">Bot-alvo (@username)</span>
        <input
          value={targetBotUsername}
          onChange={(e) => setTargetBotUsername(e.target.value.replace(/^@/, ""))}
          placeholder="usuario_do_bot"
          className="input"
        />
        <span className="block text-(--text-muted) text-xs mt-2">
          O bot que o EagleBot vai conversar sozinho, clicando em cada botão que encontrar, pra
          reconstruir o fluxo.
        </span>
      </label>

      <label className="block">
        <span className="input-label">Clonar o fluxo pra qual bot</span>
        {destBots.length > 0 ? (
          <select value={destBotId} onChange={(e) => setDestBotId(e.target.value)} className="input">
            {destBots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-(--red) text-xs">
            Você ainda não tem nenhum bot cadastrado. Cadastre um bot antes de clonar um fluxo pra
            dentro dele.
          </p>
        )}
      </label>

      <label className="block">
        <span className="input-label">Explorar usando a conta</span>
        {accounts.length > 0 ? (
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-(--red) text-xs">
            Nenhuma conta ativa agora. Conecte uma conta do Telegram no card acima antes de clonar.
          </p>
        )}
        <span className="block text-(--text-muted) text-xs mt-2">
          Essa conta vai conversar com o bot-alvo, clicando nos botões descobertos.
        </span>
      </label>

      {mode === "full" && (
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-(--text-ghost) text-xs hover:text-(--text-muted) transition-colors"
          >
            {showAdvanced ? "▾ Esconder opções avançadas" : "▸ Opções avançadas (profundidade, limites, ritmo)"}
          </button>
          {showAdvanced && (
            <div className="mt-3 pt-4 border-t border-(--border-subtle) grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-(--text-muted) text-xs">Profundidade máx.</span>
                <input
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(e.target.value.replace(/\D/g, ""))}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="text-(--text-muted) text-xs">Nós máx.</span>
                <input
                  value={maxNodes}
                  onChange={(e) => setMaxNodes(e.target.value.replace(/\D/g, ""))}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="text-(--text-muted) text-xs">Pausa por clique (ms)</span>
                <input
                  value={clickThrottleMs}
                  onChange={(e) => setClickThrottleMs(e.target.value.replace(/\D/g, ""))}
                  className="input"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-(--red) text-xs">{error}</p>}

      <button
        onClick={() => setShowRiskModal(true)}
        disabled={pending || !canSubmit}
        className="btn-primary w-full"
      >
        {pending ? "Criando..." : "Começar a clonar"}
      </button>

      <BotCloneRiskModal
        open={showRiskModal}
        confirming={pending}
        mode={mode}
        onCancel={() => setShowRiskModal(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
