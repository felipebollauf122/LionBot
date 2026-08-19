"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";

async function currentTenantId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

async function enqueueBotClone(kind: "botclone.explore" | "botclone.build-flow", cloneJobId: string): Promise<void> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  const res = await fetch(`${serverUrl}/api/mtproto/enqueue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, cloneJobId }),
  });
  if (!res.ok) throw new Error(`Falha ao enfileirar clonagem de bot (${res.status})`);
}

/**
 * Muda o status via CAS e só então enfileira — se o enqueue falhar (bot-server
 * fora do ar), desfaz o status pro valor anterior EXATO em vez de deixar o
 * job preso num status que nenhum botão da tela sabe destravar (achado da
 * revisão adversarial: sem isso, um POST que falha deixa o job "rodando" pra
 * sempre, sem worker nenhum notificado e sem caminho de retry na UI).
 *
 * Lê o status atual ANTES do CAS (em vez de usar fromStatus[0] às cegas) pra
 * saber com certeza pra onde desfazer — importante quando fromStatus aceita
 * mais de um valor (ex.: resumeBotCloneJob aceita 'paused' OU 'failed': se o
 * enqueue falhar depois de um job que estava 'failed', desfazer pra 'paused'
 * por engano perderia a mensagem de erro original e mudaria o rótulo exibido
 * sem motivo).
 */
async function casTransitionAndEnqueue(
  cloneJobId: string,
  tenantId: string,
  fromStatus: string | string[],
  toStatus: string,
  kind: "botclone.explore" | "botclone.build-flow",
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  const fromList = Array.isArray(fromStatus) ? fromStatus : [fromStatus];
  const { data: before } = await supabase
    .from("bot_clone_jobs")
    .select("status")
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId)
    .in("status", fromList)
    .maybeSingle();
  if (!before) return; // já noutro status, outro tenant, ou inexistente — no-op.
  const previousStatus = before.status;

  const { data: updated, error } = await supabase
    .from("bot_clone_jobs")
    .update({ status: toStatus, last_error: null })
    .eq("id", cloneJobId)
    .eq("status", previousStatus)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  // CAS não bateu (mudou entre a leitura e o update): não dispara o worker
  // externo, que só recebe o id e confiaria cegamente nele.
  if (!updated) return;
  try {
    await enqueueBotClone(kind, cloneJobId);
  } catch (err) {
    // Desfaz pro status exato de antes — sem isso o job fica "travado
    // rodando" sem nenhum worker notificado, e nenhum botão da tela de
    // progresso sabe como destravar (Pausar só existe pra exploring/
    // waiting_flood; Retomar só pra paused/failed).
    await supabase
      .from("bot_clone_jobs")
      .update({ status: previousStatus, last_error: `Falha ao enfileirar: ${err instanceof Error ? err.message : String(err)}` })
      .eq("id", cloneJobId)
      .eq("status", toStatus)
      .eq("tenant_id", tenantId);
    throw err;
  }
}

export type CreateBotCloneResult =
  | { ok: true; cloneJobId: string }
  | { ok: false; error: string };

export async function createBotCloneJob(input: {
  targetBotUsername: string;
  destBotId: string;
  accountId: string;
  maxDepth: number;
  maxNodes: number;
  clickThrottleMs: number;
}): Promise<CreateBotCloneResult> {
  try {
    await requireAutomationsAccess();
    const tenantId = await currentTenantId();
    const supabase = await createClient();

    const targetBotUsername = input.targetBotUsername.trim().replace(/^@/, "");
    if (!targetBotUsername) {
      return { ok: false, error: "Informe o @username do bot-alvo." };
    }

    const maxDepth = Math.min(200, Math.max(1, Math.round(input.maxDepth) || 40));
    const maxNodes = Math.min(5000, Math.max(1, Math.round(input.maxNodes) || 500));
    const clickThrottleMs = Math.max(500, Math.round(input.clickThrottleMs) || 3000);

    const { data: destBot } = await supabase
      .from("bots")
      .select("id")
      .eq("id", input.destBotId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!destBot) return { ok: false, error: "Bot de destino não encontrado." };

    const { data: account } = await supabase
      .from("mtproto_accounts")
      .select("id, status")
      .eq("id", input.accountId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!account || account.status !== "active") {
      return { ok: false, error: "A conta selecionada não existe ou não está ativa." };
    }

    const { data: job, error } = await supabase
      .from("bot_clone_jobs")
      .insert({
        tenant_id: tenantId,
        account_id: input.accountId,
        dest_bot_id: input.destBotId,
        target_bot_username: targetBotUsername,
        max_depth: maxDepth,
        max_nodes: maxNodes,
        click_throttle_ms: clickThrottleMs,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) {
      // uq_bot_clone_jobs_active_target: já existe uma exploração viva pra
      // essa (conta, bot-alvo) — ver comentário na migration sobre a corrida
      // de estado que isso evita.
      if ((error as { code?: string }).code === "23505") {
        return { ok: false, error: "Já existe uma clonagem ativa pra esse bot nessa conta." };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/dashboard/automations");
    return { ok: true, cloneJobId: job.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[createBotCloneJob] unexpected:", err);
    return { ok: false, error: msg };
  }
}

export async function launchBotCloneJob(cloneJobId: string): Promise<void> {
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await casTransitionAndEnqueue(cloneJobId, tenantId, "draft", "exploring", "botclone.explore", supabase);
  revalidatePath("/dashboard/automations");
  revalidatePath(`/dashboard/automations/botclones/${cloneJobId}`);
}

/**
 * Pausa: o explorer checa o status a cada passo (shouldStop) e aborta de
 * verdade. CAS restrito a exploring/waiting_flood (achado da revisão
 * adversarial): sem essa guarda, pausar um job em listening_remarketing
 * reseta a janela de 24h inteira quando ele é retomado (o handler trata
 * "voltou de paused com status ainda exploring" como exploração terminada e
 * relança listening_remarketing do zero), e pausar um completed o arranca de
 * volta pra exploring, duplicando o flow gerado.
 */
export async function pauseBotCloneJob(cloneJobId: string): Promise<void> {
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("bot_clone_jobs")
    .update({ status: "paused" })
    .eq("id", cloneJobId)
    .in("status", ["exploring", "waiting_flood"])
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/automations/botclones/${cloneJobId}`);
}

/**
 * Retoma um job pausado OU tenta de novo um que falhou — as duas situações
 * têm o mesmo destino (volta pra exploring, reenfileira botclone.explore); a
 * exploração é idempotente (loadExistingNodes/byParentButton só clica botão
 * sem filho ainda), então retomar um 'failed' não reprocessa nada já feito.
 */
export async function resumeBotCloneJob(cloneJobId: string): Promise<void> {
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  await casTransitionAndEnqueue(cloneJobId, tenantId, ["paused", "failed"], "exploring", "botclone.explore", supabase);
  revalidatePath(`/dashboard/automations/botclones/${cloneJobId}`);
}

export async function deleteBotCloneJob(cloneJobId: string): Promise<void> {
  await requireAutomationsAccess();
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("bot_clone_jobs")
    .delete()
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/automations");
}

type SkippedButton = { skip?: boolean; skip_reason?: string | null };
type NodeMessage = { buttons?: SkippedButton[] };

/**
 * Relatório do que foi pulado, agrupado por motivo. Diferente do clone de
 * canal (coluna `reason` plana): aqui o motivo mora dentro de
 * messages[].buttons[].skip_reason (skip=true) em bot_clone_nodes.
 */
export async function listBotCloneSkipReport(
  cloneJobId: string,
): Promise<Array<{ reason: string; count: number }>> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("bot_clone_jobs")
    .select("id")
    .eq("id", cloneJobId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!job) return [];

  // Teto bem acima do maxNodes máximo permitido na criação do job (5000,
  // ver createBotCloneJob) — achado da revisão adversarial: um teto de 2000
  // cortava jobs configurados com maxNodes > 2000 (permitido pelo form) e
  // ainda ignorava as linhas 'duplicate' de loop/botão "Voltar" (que geram
  // uma linha própria SEM contar pro maxNodes), fazendo o relatório de
  // segurança perder motivos de skip — inclusive de risco de pagamento — de
  // forma silenciosa e não-determinística (sem ORDER BY, a query nem sempre
  // corta as mesmas linhas). ORDER BY garante que, se algum dia precisar
  // cortar nesse teto de novo, sempre sobra o mesmo subconjunto (o mais
  // recente) em vez de um corte arbitrário do Postgres.
  const { data } = await supabase
    .from("bot_clone_nodes")
    .select("messages")
    .eq("job_id", cloneJobId)
    .order("captured_at", { ascending: false })
    .limit(20_000);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const messages = (row.messages ?? []) as NodeMessage[];
    for (const msg of messages) {
      for (const button of msg.buttons ?? []) {
        if (!button.skip) continue;
        const key = button.skip_reason ?? "desconhecido";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Contas elegíveis pra EXPLORAR um bot-alvo: só precisam estar ativas — ao
 * contrário do clone de canal, não há criação de canal aqui (create_restricted
 * é irrelevante), só conversa com o bot-alvo via MTProto.
 */
export async function listEligibleBotCloneAccounts(): Promise<
  Array<{ id: string; display_name: string | null; phone_number: string }>
> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mtproto_accounts")
    .select("id, display_name, phone_number")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; display_name: string | null; phone_number: string }>;
}

/** Bots do próprio tenant, pra escolher em qual clonar o fluxo descoberto. */
export async function listDestBots(): Promise<Array<{ id: string; bot_username: string }>> {
  const tenantId = await currentTenantId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bots")
    .select("id, bot_username")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; bot_username: string }>;
}
