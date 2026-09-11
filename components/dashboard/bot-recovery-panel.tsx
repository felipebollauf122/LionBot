"use client";

import { useState } from "react";
import Link from "next/link";
import { friendlyHealingError } from "@/lib/mtproto/healing-errors";
import {
  getBotRecovery,
  setBotRecovery,
  retryBotRecovery,
  type HealingRun,
  type HealingStatus,
} from "@/app/dashboard/automations/bot-recovery/actions";

export interface RecoveryBot {
  id: string;
  bot_username: string | null;
  is_active: boolean;
}

export interface RecoveryAccount {
  id: string;
  display_name: string | null;
  phone_number: string;
}

const ROTULO_STATUS: Record<HealingRun["status"], string> = {
  queued: "Na fila",
  creating: "Criando o bot novo",
  restoring: "Restaurando o perfil",
  completed: "Concluída",
  needs_attention: "Precisa de atenção",
  cancelled: "Cancelada",
};

function quando(iso: string | null): string {
  if (!iso) return "";
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleString("pt-BR");
}

export function BotRecoveryPanel({
  bots,
  accounts,
  actingTenantId,
}: {
  bots: RecoveryBot[];
  accounts: RecoveryAccount[];
  actingTenantId?: string;
}) {
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [status, setStatus] = useState<HealingStatus | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ligado, setLigado] = useState(false);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  // Sem conta conectada nao ha quem converse com o BotFather: ligar aqui so
  // produziria uma tentativa parada em `mtproto_account_unavailable`.
  const semConta = accounts.length === 0;

  async function abrir(bot: RecoveryBot) {
    if (abertoId === bot.id) {
      setAbertoId(null);
      return;
    }
    setAbertoId(bot.id);
    setStatus(null);
    setErro(null);
    // Bot desativado nem e inspecionado pelo worker: nao gasta chamada interna.
    if (!bot.is_active) return;
    setCarregando(true);
    const res = await getBotRecovery(bot.id, actingTenantId);
    setCarregando(false);
    if (!res.ok) {
      setErro(res.error);
      return;
    }
    setStatus(res.status);
    setLigado(res.status.enabled);
    setMarcadas(res.status.accountIds);
  }

  async function salvar(bot: RecoveryBot) {
    setSalvando(true);
    setErro(null);
    const res = await setBotRecovery(bot.id, ligado, marcadas, actingTenantId);
    setSalvando(false);
    // Recusa e dado: a tela nao pode passar a exibir "ligada" sem o worker ter aceitado.
    if (!res.ok) {
      setErro(res.error);
      return;
    }
    setStatus((atual) =>
      atual ? { ...atual, enabled: res.enabled, accountIds: res.accountIds } : atual,
    );
  }

  async function retomar(bot: RecoveryBot) {
    setErro(null);
    const res = await retryBotRecovery(bot.id, actingTenantId);
    if (!res.ok) {
      setErro(res.error);
      return;
    }
    const atualizado = await getBotRecovery(bot.id, actingTenantId);
    if (atualizado.ok) setStatus(atualizado.status);
  }

  if (!bots.length) {
    return (
      <p className="py-8 text-sm leading-relaxed text-(--text-secondary)">
        Você ainda não tem nenhum bot conectado. Conecte um bot primeiro — a recuperação
        substitui um bot existente que o Telegram derrubar, mantendo leads, vendas e fluxos.
      </p>
    );
  }

  return (
    <div className="divide-y divide-(--border-default)">
      {bots.map((bot) => {
        const aberto = abertoId === bot.id;
        return (
          <div key={bot.id} className="py-1">
            <button
              type="button"
              onClick={() => abrir(bot)}
              aria-expanded={aberto}
              className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-5 text-left transition-colors hover:bg-(--bg-hover)"
            >
              <span className="min-w-0">
                <span className="block font-medium text-foreground">
                  @{bot.bot_username ?? "sem username"}
                </span>
                <span className="mt-1 block text-sm text-(--text-secondary)">
                  {!bot.is_active
                    ? "Bot desativado"
                    : aberto && status
                      ? status.enabled
                        ? "Recuperação ligada"
                        : "Recuperação desligada"
                      : "Abrir para configurar"}
                </span>
              </span>
              <span className="shrink-0 text-sm text-(--text-secondary)">
                {aberto ? "Fechar" : "Abrir"}
              </span>
            </button>

            {aberto && (
              <div className="space-y-5 px-3 pb-6">
                {!bot.is_active && (
                  <p className="text-sm leading-relaxed text-(--text-secondary)">
                    Este bot está desativado. A recuperação só acompanha bots ativos — reative o
                    bot para configurá-la.
                  </p>
                )}

                {carregando && <p className="text-sm text-(--text-secondary)">Carregando…</p>}

                {erro && (
                  <p role="alert" className="text-sm leading-relaxed text-(--red)">
                    {erro}
                  </p>
                )}

                {bot.is_active && status && (
                  <>
                    {/* Mesmo espírito do aviso de automação pausada: a tela não pode
                        dizer "ligada" enquanto o worker está com a feature desligada. */}
                    {!status.workerEnabled && (
                      <p className="rounded-lg border border-(--border-default) bg-(--bg-surface) p-4 text-sm leading-relaxed text-(--text-secondary)">
                        O servidor de automações está com a recuperação desligada
                        (BOT_AUTO_HEAL_ENABLED). Enquanto isso, o que você marcar aqui fica
                        guardado, mas nenhum bot é acompanhado nem recriado.
                      </p>
                    )}

                    <label className="flex items-center gap-3 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={ligado}
                        disabled={semConta}
                        onChange={(e) => setLigado(e.target.checked)}
                      />
                      Recuperação automática deste bot
                    </label>

                    {semConta ? (
                      <p className="text-sm leading-relaxed text-(--text-secondary)">
                        Nenhuma conta do Telegram conectada. É a conta que conversa com o
                        BotFather para criar o substituto — conecte uma em{" "}
                        <Link href="/dashboard/automations/accounts" className="underline">
                          Contas Telegram
                        </Link>
                        .
                      </p>
                    ) : (
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium text-foreground">
                          Contas que podem criar o substituto
                        </legend>
                        <p className="text-sm leading-relaxed text-(--text-secondary)">
                          Sem nenhuma marcada, qualquer conta ativa pode ser usada. Cada conta do
                          Telegram cria no máximo 20 bots.
                        </p>
                        {accounts.map((conta) => (
                          <label
                            key={conta.id}
                            className="flex items-center gap-3 text-sm text-foreground"
                          >
                            <input
                              type="checkbox"
                              checked={marcadas.includes(conta.id)}
                              onChange={(e) =>
                                setMarcadas((atual) =>
                                  e.target.checked
                                    ? [...atual, conta.id]
                                    : atual.filter((id) => id !== conta.id),
                                )
                              }
                            />
                            {conta.display_name ?? "Conta"} · {conta.phone_number}
                          </label>
                        ))}
                      </fieldset>
                    )}

                    {/* Sem cópia de identidade não há o que restaurar: a tentativa
                        morreria em `identity_backup_missing`. Melhor dizer antes. */}
                    {status.identityReady ? (
                      <p className="text-sm leading-relaxed text-(--text-secondary)">
                        Identidade copiada
                        {status.backedUpAt ? ` em ${quando(status.backedUpAt)}` : ""} — nome,
                        descrição e foto serão restaurados no bot novo.
                      </p>
                    ) : (
                      <p className="text-sm leading-relaxed text-(--text-secondary)">
                        Ainda não existe uma cópia da identidade deste bot. A cópia da identidade
                        (nome, descrição e foto) é feita sozinha com a recuperação ligada e o bot
                        no ar — deixe ligado e aguarde o próximo ciclo antes de contar com ela.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => salvar(bot)}
                      disabled={salvando}
                      className="btn-primary"
                    >
                      {salvando ? "Salvando…" : "Salvar"}
                    </button>

                    {status.runs.length > 0 && (
                      <div className="space-y-3 border-t border-(--border-default) pt-5">
                        <h3 className="text-sm font-medium text-foreground">Tentativas</h3>
                        {status.runs.map((run) => {
                          const mensagem = friendlyHealingError(run.error_code);
                          return (
                            <div
                              key={run.id}
                              className="rounded-lg border border-(--border-default) p-4"
                            >
                              <p className="text-sm text-foreground">
                                {ROTULO_STATUS[run.status] ?? run.status}
                                {run.created_at ? ` · ${quando(run.created_at)}` : ""}
                              </p>
                              {run.new_username && (
                                <p className="mt-1 text-sm text-(--text-secondary)">
                                  Bot recriado como @{run.new_username}
                                </p>
                              )}
                              {mensagem && (
                                <p className="mt-2 text-sm leading-relaxed text-(--text-secondary)">
                                  {mensagem}
                                </p>
                              )}
                              {run.status === "needs_attention" && (
                                <button
                                  type="button"
                                  onClick={() => retomar(bot)}
                                  className="btn-ghost mt-3"
                                >
                                  Tentar de novo
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
