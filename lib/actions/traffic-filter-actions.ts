"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import type {
  TrafficFilterRule,
  TrafficFilterList,
  TrafficFilterMatchType,
} from "@/lib/types/database";

async function assertTenantAccess(tenantId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  if (await isAdmin()) return;
  if (user.id !== tenantId) throw new Error("Forbidden");
}

export async function listRules(tenantId: string): Promise<TrafficFilterRule[]> {
  await assertTenantAccess(tenantId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("traffic_filter_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list rules: ${error.message}`);
  return (data ?? []) as TrafficFilterRule[];
}

export async function addRule(input: {
  tenantId: string;
  list: TrafficFilterList;
  matchType: TrafficFilterMatchType;
  value: string;
  note?: string;
}): Promise<{ success: true }> {
  await assertTenantAccess(input.tenantId);
  const value = input.value.trim();
  if (!value) throw new Error("Valor da regra não pode ser vazio");

  const supabase = await createClient();
  const { error } = await supabase.from("traffic_filter_rules").insert({
    tenant_id: input.tenantId,
    list: input.list,
    match_type: input.matchType,
    value,
    note: input.note?.trim() || null,
  });
  if (error) throw new Error(`Failed to add rule: ${error.message}`);
  return { success: true };
}

export async function deleteRule(ruleId: string): Promise<{ success: true }> {
  const supabase = await createClient();
  // Carrega a regra p/ validar o tenant antes de apagar
  const { data: rule } = await supabase
    .from("traffic_filter_rules")
    .select("tenant_id")
    .eq("id", ruleId)
    .single();
  if (!rule) throw new Error("Rule not found");
  await assertTenantAccess(rule.tenant_id as string);

  const { error } = await supabase.from("traffic_filter_rules").delete().eq("id", ruleId);
  if (error) throw new Error(`Failed to delete rule: ${error.message}`);
  return { success: true };
}

export async function toggleRule(ruleId: string, isActive: boolean): Promise<{ success: true }> {
  const supabase = await createClient();
  const { data: rule } = await supabase
    .from("traffic_filter_rules")
    .select("tenant_id")
    .eq("id", ruleId)
    .single();
  if (!rule) throw new Error("Rule not found");
  await assertTenantAccess(rule.tenant_id as string);

  const { error } = await supabase
    .from("traffic_filter_rules")
    .update({ is_active: isActive })
    .eq("id", ruleId);
  if (error) throw new Error(`Failed to toggle rule: ${error.message}`);
  return { success: true };
}

export async function toggleTrafficFilter(botId: string, enabled: boolean): Promise<{ success: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = await isAdmin();
  let botQuery = supabase.from("bots").select("id").eq("id", botId);
  if (!admin) botQuery = botQuery.eq("tenant_id", user.id);
  const { data: bot } = await botQuery.single();
  if (!bot) throw new Error("Bot not found");

  const { error } = await supabase
    .from("bots")
    .update({ traffic_filter_enabled: enabled })
    .eq("id", botId);
  if (error) throw new Error(`Failed to toggle traffic filter: ${error.message}`);
  return { success: true };
}
