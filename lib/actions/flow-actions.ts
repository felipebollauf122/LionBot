"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { FlowData, TriggerType } from "@/lib/types/database";
import { invalidateBotCache } from "@/lib/actions/cache-actions";
import { isAdmin } from "@/lib/actions/admin-actions";
import { buildDefaultLoginFlow } from "@/lib/mtproto-login-flow-template";
import { validateFlowData } from "@/lib/flow-validation";

/**
 * Cria (uma única vez) o flow padrão de um bot de login MTProto.
 * Cada nó tem `data.login_slot` indicando qual etapa da máquina de estado
 * ele representa: welcome | code_prompt | password_prompt | success | error.
 * O handler do bot busca o nó pelo slot e usa seu conteúdo (texto/mídia) na
 * mensagem enviada ao usuário. O cliente edita esses nós pelo flow editor
 * existente.
 */
export async function seedLoginBotFlow(botId: string): Promise<{ flowId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: bot } = await supabase
    .from("bots")
    .select("id, tenant_id")
    .eq("id", botId)
    .eq("tenant_id", user.id)
    .single();
  if (!bot) throw new Error("Bot not found");

  const { data: existing } = await supabase
    .from("flows")
    .select("id")
    .eq("bot_id", botId)
    .eq("name", "_mtproto_login_flow")
    .maybeSingle();
  if (existing) return { flowId: existing.id };

  const { data: flow, error } = await supabase
    .from("flows")
    .insert({
      tenant_id: bot.tenant_id,
      bot_id: botId,
      name: "_mtproto_login_flow",
      trigger_type: "command",
      trigger_value: "/start",
      flow_data: buildDefaultLoginFlow(),
      is_active: true,
      version: 1,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to seed login flow: ${error.message}`);
  invalidateBotCache(botId);
  return { flowId: flow.id };
}

export async function createFlow(botId: string, name: string, triggerType: TriggerType, triggerValue: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!tenant) throw new Error("Tenant not found");

  // Verify bot belongs to this tenant
  const { data: bot } = await supabase.from("bots").select("id").eq("id", botId).eq("tenant_id", tenant.id).single();
  if (!bot) throw new Error("Bot not found");

  const defaultFlowData: FlowData = {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        data: { trigger: triggerType, command: triggerValue },
        position: { x: 250, y: 50 },
      },
    ],
    edges: [],
  };

  const { data: flow, error } = await supabase
    .from("flows")
    .insert({
      tenant_id: tenant.id,
      bot_id: botId,
      name,
      trigger_type: triggerType,
      trigger_value: triggerValue,
      flow_data: defaultFlowData,
      is_active: false,
      version: 1,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create flow: ${error.message}`);

  redirect(`/dashboard/bots/${botId}/flows/${flow.id}/editor`);
}

export async function saveFlow(flowId: string, flowData: FlowData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const validation = validateFlowData(flowData);
  if (!validation.ok) return { success: false };

  const admin = await isAdmin();
  let query = supabase.from("flows").update({ flow_data: flowData }).eq("id", flowId);
  if (!admin) query = query.eq("tenant_id", user.id);

  const { data, error } = await query.select("id");
  if (error) throw new Error(`Failed to save flow: ${error.message}`);
  // 0 rows updated: flow deleted in another tab, wrong tenant, or blocked by RLS
  if (!data || data.length === 0) return { success: false };

  // Invalidate engine cache — fetch bot_id from the flow
  const { data: flowRow } = await supabase.from("flows").select("bot_id").eq("id", flowId).single();
  if (flowRow) invalidateBotCache(flowRow.bot_id);

  return { success: true };
}

export async function toggleFlow(flowId: string, isActive: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let query = supabase.from("flows").update({ is_active: isActive }).eq("id", flowId);
  if (!admin) query = query.eq("tenant_id", user.id);

  const { error } = await query;
  if (error) throw new Error(`Failed to toggle flow: ${error.message}`);

  const { data: flowRow } = await supabase.from("flows").select("bot_id").eq("id", flowId).single();
  if (flowRow) invalidateBotCache(flowRow.bot_id);

  return { success: true };
}

/**
 * Get or create a named flow (_visual_flow or _black_flow).
 * These flows use "command" trigger with "/start" but are selected by name, not trigger matching.
 */
export async function getOrCreateNamedFlow(botId: string, flowName: "_visual_flow" | "_black_flow") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id, tenant_id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  // Check if flow already exists
  const { data: existing } = await supabase
    .from("flows")
    .select("*")
    .eq("bot_id", botId)
    .eq("name", flowName)
    .maybeSingle();

  if (existing) return existing;

  const defaultFlowData: FlowData = {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        data: { trigger: "command", command: "/start" },
        position: { x: 250, y: 50 },
      },
    ],
    edges: [],
  };

  const { data: flow, error } = await supabase
    .from("flows")
    .insert({
      tenant_id: bot.tenant_id,
      bot_id: botId,
      name: flowName,
      trigger_type: "command",
      trigger_value: "/start",
      flow_data: defaultFlowData,
      is_active: false,
      version: 1,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to create ${flowName}: ${error.message}`);
  return flow;
}

export async function deleteFlow(flowId: string, botId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let query = supabase.from("flows").delete().eq("id", flowId);
  if (!admin) query = query.eq("tenant_id", user.id);

  const { error } = await query;
  if (error) throw new Error(`Failed to delete flow: ${error.message}`);

  redirect(`/dashboard/bots/${botId}/flows`);
}
