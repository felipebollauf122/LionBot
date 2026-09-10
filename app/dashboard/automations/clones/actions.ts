"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireAutomationsAccess } from "@/lib/actions/automations-access-actions";
import { resolveActingTenantId } from "@/lib/actions/admin-actions";
import { deriveDestKind, isClonableKind } from "@/lib/mtproto/clone-kind";
import type { ActionResult } from "@/lib/social-proof/types";

/**
 * Roda `corpo` atrás da checagem de acesso, sem deixar NADA escapar como
 * `throw` — cópia deliberada de `comGuarda` em
 * `app/dashboard/automations/scheduled/actions.ts`, e pelo MESMO motivo
 * documentado lá: um erro lançado de dentro de uma Server Action é apagado
 * pelo Next em produção e chega ao usuário como uma string genérica em
 * inglês. Faltar a assinatura de automações é recusa PREVISTA, não exceção,
 * então vira dado como qualquer outra.
 *
 * (Não é importado de lá porque um módulo "use server" só pode exportar
 * função async — `comGuarda` é interna aos dois arquivos.)
 */
async function comGuarda<T extends ActionResult>(
  acao: string,
  corpo: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    await requireAutomationsAccess();
  } catch {
    return { ok: false, error: "Seu plano não inclui as automações do Telegram." };
  }

  try {
    return await corpo();
  } catch (err) {
    console.error(`[${acao}] erro inesperado:`, err);
    return { ok: false, error: "Não foi possível concluir a ação. Tente de novo." };
  }
}

async function enqueueClone(cloneJobId: string): Promise<void> {
  const serverUrl = (process.env.NEXT_PUBLIC_BOT_SERVER_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    "",
  );
  const res = await fetch(`${serverUrl}/api/mtproto/enqueue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // A rota do worker exige segredo compartilhado desde que passou a
      // aceitar `postcampaign.send-one` e `campaign.ai-process`: os dois
      // despacham pra handlers de SERVICE ROLE que confiam no id recebido,
      // então um POST anônimo publicava mensagem agendada de outro tenant ou
      // queimava quota do Gemini. Ver server/src/index.ts.
      "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
    },
    body: JSON.stringify({ kind: "clone.run", cloneJobId }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 503
        ? "O servidor de automações recusou a chamada interna. Confira INTERNAL_API_SECRET nos dois lados."
        : `Falha ao enfileirar clone (${res.status})`,
    );
  }
}

export type SaveBotResult = { ok: true; username: string } | { ok: false; error: string };

/**
 * Valida o token no Telegram antes de salvar. O erro comum é o owner colar o
 * token errado e só descobrir quando o clone falha na mensagem 1.
 */
export async function saveAutomationBot(
  token: string,
  actingTenantId?: string,
): Promise<SaveBotResult | { ok: false; error: string }> {
  return comGuarda("saveAutomationBot", async (): Promise<SaveBotResult> => {
    const tenantId = await resolveActingTenantId(actingTenantId);
    const clean = token.trim();
    if (!clean) return { ok: false, error: "Cole o token do BotFather." };

    let me: { id: number; username?: string; is_bot: boolean };
    try {
      const res = await fetch(`https://api.telegram.org/bot${clean}/getMe`);
      const body = (await res.json()) as { ok: boolean; result?: typeof me; description?: string };
      if (!body.ok || !body.result) {
        return { ok: false, error: body.description ?? "Token recusado pelo Telegram." };
      }
      me = body.result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!me.is_bot) return { ok: false, error: "Esse token não é de um bot." };
    if (!me.username) {
      return { ok: false, error: "O bot precisa de @username para ser promovido a admin." };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("automation_bots").upsert(
      {
        tenant_id: tenantId,
        token: clean,
        bot_user_id: String(me.id),
        username: me.username,
        session_string: null,
        status: "active",
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    );
    if (error) return { ok: false, error: `Não deu pra salvar o bot: ${error.message}` };

    revalidatePath("/dashboard/automations");
    return { ok: true, username: me.username };
  });
}

export async function removeAutomationBot(actingTenantId?: string): Promise<ActionResult> {
  return comGuarda("removeAutomationBot", async () => {
    const tenantId = await resolveActingTenantId(actingTenantId);
    const supabase = await createClient();
    const { error } = await supabase.from("automation_bots").delete().eq("tenant_id", tenantId);
    if (error) return { ok: false, error: `Não deu pra remover o bot: ${error.message}` };
    revalidatePath("/dashboard/automations");
    return { ok: true };
  });
}

export type CreateCloneResult =
  | { ok: true; cloneJobId: string; draftCampaignId?: string }
  | { ok: false; error: string };

/** Vazio vira null (categoria não é trocada); '@' na frente do bot é ignorado. */
function normalizeLinkReplace(raw: string, stripAt = false): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return stripAt ? trimmed.replace(/^@/, "") : trimmed;
}

export async function createCloneJob(input: {
  dialogId: string;
  destTitle: string;
  copyIdentity: boolean;
  messageLimit: number | null;
  throttleMs: number;
  copyReplies: boolean;
  copyPins: boolean;
  copyButtons: boolean;
  copyPolls: boolean;
  /** Conta que cria o destino. Omitido/igual à origem = mesma conta. */
  destAccountId?: string;
  /** Username sem @ pra trocar todo bot mencionado/linkado no conteúdo clonado. Vazio = não troca. */
  linkReplaceBot: string;
  /** Link pra trocar todo grupo mencionado/linkado. Vazio = não troca. */
  linkReplaceGroup: string;
  /** Link pra trocar todo canal mencionado/linkado. Vazio = não troca. */
  linkReplaceChannel: string;
  /** 'draft' manda o conteúdo pro rascunho de uma campanha em vez de publicar. */
  mode: "live" | "draft";
  aiClean: boolean;
  aiRewrite: boolean;
  aiSmartDelay: boolean;
  actingTenantId?: string;
}): Promise<CreateCloneResult | { ok: false; error: string }> {
  return comGuarda("createCloneJob", async (): Promise<CreateCloneResult> => {
    const tenantId = await resolveActingTenantId(input.actingTenantId);
    const supabase = await createClient();

    const { data: bot } = await supabase
      .from("automation_bots")
      .select("id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!bot) {
      return { ok: false, error: "Cadastre o bot companheiro antes de clonar." };
    }

    const { data: dialog } = await supabase
      .from("mtproto_dialogs")
      .select("id, account_id, peer_id, peer_type, peer_access_hash, kind, title, mtproto_accounts!inner(tenant_id)")
      .eq("id", input.dialogId)
      .eq("mtproto_accounts.tenant_id", tenantId)
      .single();
    if (!dialog) return { ok: false, error: "Origem não encontrada." };
    if (!isClonableKind(dialog.kind)) {
      return { ok: false, error: "Só dá para clonar canal ou grupo." };
    }
    if (input.messageLimit !== null && (input.messageLimit < 1 || input.messageLimit > 50000)) {
      return { ok: false, error: "O limite de mensagens vai de 1 a 50.000." };
    }

    // Teto do modo rascunho: um clone de 20 mil posts com vídeo viraria
    // dezenas de GB no Storage e horas só pra montar o rascunho, e nenhuma
    // campanha de conteúdo real tem esse tamanho. 500 é o default; 1000 o
    // máximo aceito.
    const ehRascunho = input.mode === "draft";
    const messageLimit = ehRascunho
      ? Math.min(input.messageLimit ?? 500, 1000)
      : input.messageLimit;

    // Conta que cria o destino: default = a mesma da origem. Se for outra,
    // valida que é do tenant, ativa e NÃO restrita (senão o createChannel
    // falharia com USER_RESTRICTED).
    const destAccountId = input.destAccountId?.trim() || dialog.account_id;
    if (destAccountId !== dialog.account_id) {
      const { data: destAcc } = await supabase
        .from("mtproto_accounts")
        .select("id, status, create_restricted")
        .eq("id", destAccountId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!destAcc || destAcc.status !== "active") {
        return { ok: false, error: "A conta de destino não existe ou não está ativa." };
      }
      if (destAcc.create_restricted) {
        return { ok: false, error: "A conta de destino está restrita e não cria canais. Escolha outra." };
      }
    }

    let draftCampaignId: string | null = null;
    if (ehRascunho) {
      const { data: campaign, error: campErr } = await supabase
        .from("mtproto_scheduled_campaigns")
        .insert({
          tenant_id: tenantId,
          name: input.destTitle.trim() || `${dialog.title ?? "Clone"} (campanha)`,
          status: "draft",
          ai_clean: input.aiClean,
          ai_rewrite: input.aiRewrite,
          ai_smart_delay: input.aiSmartDelay,
        })
        .select("id")
        .single();
      if (campErr) return { ok: false, error: campErr.message };
      draftCampaignId = campaign.id;
    }

    const { data: job, error } = await supabase
      .from("clone_jobs")
      .insert({
        tenant_id: tenantId,
        account_id: dialog.account_id,
        dest_account_id: destAccountId,
        source_dialog_id: dialog.id,
        source_peer_id: dialog.peer_id,
        source_peer_type: dialog.peer_type,
        source_peer_access_hash: dialog.peer_access_hash,
        source_title: dialog.title,
        dest_kind: deriveDestKind(dialog.kind),
        dest_title: input.destTitle.trim() || `${dialog.title ?? "Clone"} (clone)`,
        copy_identity: input.copyIdentity,
        message_limit: messageLimit,
        throttle_ms: input.throttleMs,
        copy_replies: input.copyReplies,
        copy_pins: input.copyPins,
        copy_buttons: input.copyButtons,
        copy_polls: input.copyPolls,
        link_replace_bot: normalizeLinkReplace(input.linkReplaceBot, true),
        link_replace_group: normalizeLinkReplace(input.linkReplaceGroup),
        link_replace_channel: normalizeLinkReplace(input.linkReplaceChannel),
        status: "draft",
        mode: input.mode,
        draft_campaign_id: draftCampaignId,
        ai_clean: input.aiClean,
        ai_rewrite: input.aiRewrite,
        ai_smart_delay: input.aiSmartDelay,
      })
      .select("id")
      .single();
    if (error) {
      if (draftCampaignId) {
        await supabase.from("mtproto_scheduled_campaigns").delete().eq("id", draftCampaignId);
      }
      return { ok: false, error: error.message };
    }

    // Depois desta linha o job EXISTE. Qualquer falha daqui pra frente não
    // pode mais virar `{ ok: false }`: o usuário leria "não deu certo",
    // tentaria de novo, e acabaria com dois jobs e duas campanhas clonando o
    // mesmo canal. Por isso a ligação `source_clone_job_id` tem try/catch
    // PRÓPRIO — antes ela ficava debaixo do catch geral, e uma exceção de
    // verdade (rede, RLS, timeout) transformava um job criado em fracasso
    // reportado.
    //
    // Perder a ligação degrada só o rastro (a campanha não aponta pro job que
    // a preencheu); o clone e a campanha seguem funcionando, e o rascunho
    // continua chegando lá.
    if (draftCampaignId) {
      try {
        const { error: erroLigacao } = await supabase
          .from("mtproto_scheduled_campaigns")
          .update({ source_clone_job_id: job.id })
          .eq("id", draftCampaignId);
        if (erroLigacao) {
          console.error("[createCloneJob] ligação campanha->job falhou:", erroLigacao.message);
        }
      } catch (err) {
        console.error("[createCloneJob] ligação campanha->job lançou:", err);
      }
    }

    revalidatePath("/dashboard/automations");
    return { ok: true, cloneJobId: job.id, draftCampaignId: draftCampaignId ?? undefined };
  });
}

export async function launchClone(cloneJobId: string): Promise<ActionResult> {
  return comGuarda("launchClone", async () => {
    const supabase = await createClient();
    // Sem filtro de tenant_id — RLS de clone_jobs cobre (própria ou, se admin, qualquer tenant).
    const { data: updated, error } = await supabase
      .from("clone_jobs")
      .update({ status: "running", last_error: null })
      .eq("id", cloneJobId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: `Não deu pra iniciar o clone: ${error.message}` };
    // Job de outro tenant (ou inexistente) não bate nenhuma linha: não pode
    // disparar o worker externo, que só recebe o id e confiaria cegamente nele.
    if (!updated) {
      return { ok: false, error: "Clone não encontrado (ou sem permissão)." };
    }

    // O enqueue fala com o bot-server por HTTP e pode falhar (serviço fora do
    // ar, segredo interno errado). Antes isso subia como throw; agora vira
    // dado, com a mensagem que o `enqueueClone` montou.
    try {
      await enqueueClone(cloneJobId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    revalidatePath("/dashboard/automations");
    revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
    return { ok: true };
  });
}

/** Pausa: o runner checa o status entre cada grupo e aborta. O cursor fica salvo. */
export async function pauseClone(cloneJobId: string): Promise<ActionResult> {
  return comGuarda("pauseClone", async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clone_jobs")
      .update({ status: "paused" })
      .eq("id", cloneJobId)
      .select("id");
    if (error) return { ok: false, error: `Não deu pra pausar: ${error.message}` };
    if (!data || data.length === 0) {
      return { ok: false, error: "Clone não encontrado (ou sem permissão)." };
    }
    revalidatePath(`/dashboard/automations/clones/${cloneJobId}`);
    return { ok: true };
  });
}

export async function deleteClone(cloneJobId: string): Promise<ActionResult> {
  return comGuarda("deleteClone", async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("clone_jobs")
      .delete()
      .eq("id", cloneJobId)
      .select("id");
    if (error) return { ok: false, error: `Não deu pra apagar: ${error.message}` };
    // Delete que não pegou nada NÃO vira `error` no supabase-js — sem esta
    // contagem, apagar o clone de outro tenant responderia sucesso.
    if (!data || data.length === 0) {
      return { ok: false, error: "Clone não encontrado (ou sem permissão)." };
    }
    revalidatePath("/dashboard/automations");
    return { ok: true };
  });
}

/** Relatório: o que foi pulado, agrupado por motivo. */
export async function listCloneSkipReport(
  cloneJobId: string,
): Promise<Array<{ reason: string; count: number }>> {
  // Leitura: degrada pro vazio em vez de lançar, mesmo raciocínio de
  // `getScheduledCampaign` — é o que um job inexistente já devolve abaixo.
  try {
    await requireAutomationsAccess();
  } catch {
    return [];
  }

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("clone_jobs")
    .select("id")
    .eq("id", cloneJobId)
    .maybeSingle();
  if (!job) return [];

  const { data } = await supabase
    .from("clone_message_map")
    .select("reason")
    .eq("job_id", cloneJobId)
    .in("status", ["skipped", "failed"])
    .limit(5000);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = row.reason ?? "desconhecido";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Contas que podem CRIAR o destino de um clone: ativas e não-restritas pelo
 * anti-spam do Telegram (create_restricted=false). Alimenta o seletor "criar
 * destino em" do formulário de clone.
 */
export async function listEligibleDestAccounts(actingTenantId?: string): Promise<
  Array<{ id: string; display_name: string | null; phone_number: string }>
> {
  // Leitura de uma Server Component (clones/new/page.tsx). Lançar aqui
  // derruba a página inteira num erro genérico em inglês; a lista vazia já
  // tem um caminho de UI ("nenhuma conta elegível"), então é o degrade certo.
  try {
    const tenantId = await resolveActingTenantId(actingTenantId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("mtproto_accounts")
      .select("id, display_name, phone_number")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .eq("create_restricted", false)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[listEligibleDestAccounts]", error.message);
      return [];
    }
    return (data ?? []) as Array<{ id: string; display_name: string | null; phone_number: string }>;
  } catch (err) {
    console.error("[listEligibleDestAccounts] erro inesperado:", err);
    return [];
  }
}

/**
 * Limpa o flag create_restricted de uma conta — pro owner usar depois de
 * resolver a restrição no @SpamBot. Owner-only, escopado por tenant.
 */
export async function clearAccountRestriction(accountId: string): Promise<ActionResult> {
  return comGuarda("clearAccountRestriction", async () => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("mtproto_accounts")
      .update({ create_restricted: false })
      .eq("id", accountId)
      .select("id");
    if (error) return { ok: false, error: `Não deu pra liberar a conta: ${error.message}` };
    if (!data || data.length === 0) {
      return { ok: false, error: "Conta não encontrada (ou sem permissão)." };
    }
    revalidatePath("/dashboard/automations");
    return { ok: true };
  });
}
