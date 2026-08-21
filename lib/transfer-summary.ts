/**
 * Resumo em português do que uma transferência de bot moveu.
 *
 * A função SQL public.transfer_bot_owner (migration 067) devolve a contagem
 * crua por nome de tabela — isso vira "232 leads, 14 vendas, 3 fluxos" na UI.
 * Módulo separado do componente porque o modal importa a server action, que
 * arrasta next/cache e o cliente Supabase junto; aqui fica só o texto.
 */

const TABLE_LABEL: Record<string, string> = {
  leads: "leads",
  transactions: "vendas",
  flows: "fluxos",
  products: "produtos",
  product_bundles: "conjuntos",
  tracking_events: "eventos de tracking",
  remarketing_configs: "configs de remarketing",
  remarketing_flows: "fluxos de remarketing",
  remarketing_variant_sends: "envios de remarketing",
  lead_messages: "mensagens",
  media_assets: "mídias",
  mtproto_login_sessions: "sessões de login",
  tenant_lead_identity_copied: "atribuições de campanha",
};

/**
 * Junta as contagens numa frase, da maior pra menor. Tabela zerada some (bot
 * sem venda nenhuma não precisa dizer "0 vendas"); tabela desconhecida — se
 * uma migration futura acrescentar uma — aparece com o nome cru em vez de
 * sumir, pra a UI não mentir sobre o que foi movido.
 */
export function summarizeMoved(moved: Record<string, number>): string {
  const parts = Object.entries(moved)
    .filter(([, n]) => typeof n === "number" && n > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([table, n]) => `${n} ${TABLE_LABEL[table] ?? table}`);

  return parts.length > 0 ? parts.join(", ") : "nenhum registro além do próprio bot";
}
