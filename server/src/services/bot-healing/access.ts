import { supabase } from "../../db.js";
import { MemoryCache } from "../../cache.js";

/**
 * Recuperação de bot é uma feature paga: só owner (singleton da instância) ou
 * assinante premium. Mesma regra de `canAccessAutomations` no painel
 * (lib/actions/automations-access-actions.ts), replicada aqui porque o worker
 * não passa pelo Next: o scan varre a frota inteira de minuto em minuto e
 * recriaria bot de quem já saiu do plano.
 *
 * TTL curto porque a varredura pergunta por bot; uma queda de plano leva no
 * máximo um ciclo para valer.
 */
const cache = new MemoryCache<boolean>(60, 5000);

export async function tenantHasHealing(tenantId: string): Promise<boolean> {
  const cached = cache.get(tenantId);
  if (cached !== undefined) return cached;
  const { data, error } = await supabase
    .from("tenants")
    .select("is_owner,is_premium")
    .eq("id", tenantId)
    .maybeSingle();
  // Nunca degrada para `false`: um soluço do banco desligaria a recuperação da
  // frota inteira sem deixar rastro na tela. Quem chama trata como transitório.
  if (error) throw new Error("healing_access_read_failed");
  const allowed = data?.is_owner === true || data?.is_premium === true;
  cache.set(tenantId, allowed);
  return allowed;
}
