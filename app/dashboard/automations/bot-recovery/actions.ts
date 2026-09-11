"use server";

import { revalidatePath } from "next/cache";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";

export interface HealingRun {
  id: string;
  status: "queued" | "creating" | "restoring" | "completed" | "needs_attention" | "cancelled";
  new_username: string | null;
  retry_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface HealingStatus {
  /** BOT_AUTO_HEAL_ENABLED no worker: com `false`, ligar aqui não faz nada. */
  workerEnabled: boolean;
  enabled: boolean;
  accountIds: string[];
  backedUpAt: string | null;
  /** Há cópia de identidade válida PARA O TOKEN ATUAL. Sem isso não há o que restaurar. */
  identityReady: boolean;
  runs: HealingRun[];
}

type Falha = { ok: false; error: string };

const ROTA = "/dashboard/automations/bot-recovery";

/**
 * Roda `corpo` atrás da checagem de acesso sem deixar NADA escapar como
 * `throw` — mesma convenção (e mesmo motivo) de `comGuarda` em
 * `clones/actions.ts` e `scheduled/actions.ts`: erro LANÇADO de dentro de uma
 * Server Action é apagado pelo Next em produção e chega ao usuário como
 * "An error occurred in the Server Components render...". Recusa prevista
 * (sem plano, worker fora do ar, segredo trocado) é DADO.
 */
async function comGuarda<T extends { ok: boolean }>(
  acao: string,
  corpo: () => Promise<T | Falha>,
): Promise<T | Falha> {
  try {
    await requireAutomationsAccess();
  } catch {
    return { ok: false, error: "Seu plano não inclui a recuperação automática de bots." };
  }
  try {
    return await corpo();
  } catch (err) {
    console.error(`[${acao}] erro inesperado:`, err);
    return { ok: false, error: "Não foi possível concluir a ação. Tente de novo." };
  }
}

/** Traduz a recusa do worker. O código cru fica no corpo; a tela recebe frase. */
async function traduzRecusa(res: Response): Promise<string> {
  const code = await res
    .json()
    .then((b) => (b as { error?: string })?.error ?? "")
    .catch(() => "");
  switch (code) {
    // As duas causas de 403 são diferentes: uma é o cliente, a outra é config.
    case "healing_not_available":
      return "A recuperação automática faz parte do plano premium. Ative a assinatura para usá-la.";
    case "unauthorized":
      return "O painel e o servidor de automações estão com INTERNAL_API_SECRET diferentes (ou o worker subiu sem a variável). Copie o mesmo valor nos dois, sem aspas nem espaços, e publique o painel de novo.";
    case "bot_not_found":
      return "Esse bot não existe ou não pertence à conta em vigor.";
    case "invalid_bot_or_tenant":
      return "Identificador de bot ou de conta inválido. Atualize a página e tente de novo.";
    case "account_not_owned_by_tenant":
      return "Uma das contas do Telegram selecionadas não pertence a esta conta. Atualize a página e selecione de novo.";
    case "provide_enabled_and_accountIds":
      return "Seleção inválida: escolha no máximo 20 contas do Telegram.";
    case "healing_disabled":
      return "A recuperação está desligada para este bot, ou está inativa no servidor. Ligue-a antes de tentar de novo.";
    case "no_recoverable_run":
      return "Não há nenhuma tentativa parada esperando retomada para este bot.";
    case "healing_storage_unavailable":
      return "O servidor de automações não conseguiu ler os dados da recuperação agora. Tente de novo em instantes.";
    default:
      return `O servidor de automações recusou a chamada (${res.status}).`;
  }
}

async function chamarWorker(
  caminho: string,
  init: { method: string; body?: string },
): Promise<{ ok: true; body: Record<string, unknown> } | Falha> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${serverUrl}${caminho}`, {
      method: init.method,
      body: init.body,
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      cache: "no-store",
    });
  } catch (err) {
    // Worker fora do ar vira `TypeError: fetch failed`, que em produção
    // chegaria apagado — e sem dizer que o problema é o servidor, não a conta.
    console.error("[bot-recovery] servidor de automações inacessível:", err);
    return {
      ok: false,
      error:
        "O servidor de automações não respondeu. Confira se o worker está no ar e se NEXT_PUBLIC_BOT_SERVER_URL aponta pra ele.",
    };
  }
  if (!res.ok) return { ok: false, error: await traduzRecusa(res) };
  return { ok: true, body: (await res.json()) as Record<string, unknown> };
}

export async function getBotRecovery(
  botId: string,
  actingTenantId?: string,
): Promise<{ ok: true; status: HealingStatus } | Falha> {
  return comGuarda("getBotRecovery", async () => {
    const tenantId = await resolveActingTenantId(actingTenantId);
    const res = await chamarWorker(
      `/api/bots/${encodeURIComponent(botId)}/auto-healing?tenantId=${encodeURIComponent(tenantId)}`,
      { method: "GET" },
    );
    if (!res.ok) return res;
    return { ok: true as const, status: res.body as unknown as HealingStatus };
  });
}

export async function setBotRecovery(
  botId: string,
  enabled: boolean,
  accountIds: string[],
  actingTenantId?: string,
): Promise<{ ok: true; enabled: boolean; accountIds: string[] } | Falha> {
  return comGuarda("setBotRecovery", async () => {
    const tenantId = await resolveActingTenantId(actingTenantId);
    const res = await chamarWorker(`/api/bots/${encodeURIComponent(botId)}/auto-healing`, {
      method: "POST",
      body: JSON.stringify({ tenantId, enabled, accountIds }),
    });
    if (!res.ok) return res;
    revalidatePath(ROTA);
    return {
      ok: true as const,
      enabled: res.body.enabled === true,
      accountIds: (res.body.accountIds as string[]) ?? [],
    };
  });
}

export async function retryBotRecovery(
  botId: string,
  actingTenantId?: string,
): Promise<{ ok: true; runId: string } | Falha> {
  return comGuarda("retryBotRecovery", async () => {
    const tenantId = await resolveActingTenantId(actingTenantId);
    const res = await chamarWorker(`/api/bots/${encodeURIComponent(botId)}/auto-healing/retry`, {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    });
    if (!res.ok) return res;
    revalidatePath(ROTA);
    return { ok: true as const, runId: String(res.body.runId ?? "") };
  });
}
