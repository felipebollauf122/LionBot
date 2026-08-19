import type { SupabaseClient } from "@supabase/supabase-js";

export interface IncomingTracking {
  tid?: string;
  fbclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

export interface ResolvedIdentity {
  tid: string | null;
  fbclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

/**
 * Resolve a identidade de tracking de um lead dentro de um tenant.
 *
 * Comportamento:
 *  - Se `incoming` traz tid/fbclid/UTMs: ATUALIZA o registro do tenant
 *    com esses valores (atribuição "last touch") e retorna o que foi
 *    salvo. Cada bot novo desse tenant que esse user entrar via campanha
 *    nova passa a ter o tid mais recente — comportamento que o user
 *    pediu explicitamente.
 *  - Se `incoming` está vazio (link direto, deeplink antigo, etc): USA
 *    o que já estava salvo na tabela tenant_lead_identity. Lead que
 *    entrou no bot A com campanha e agora aparece no bot B sem nada
 *    "herda" a atribuição original.
 *  - Se não tem registro nenhum e nada veio: retorna tudo null.
 *
 * Sempre faz um upsert do registro do tenant com last_bot_id atual
 * pra manter a tabela viva como "memória" do tenant.
 */
export async function resolveTenantIdentity(
  db: SupabaseClient,
  tenantId: string,
  telegramUserId: number,
  botId: string,
  incoming: IncomingTracking,
): Promise<ResolvedIdentity> {
  const { data: existing } = await db
    .from("tenant_lead_identity")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  const hasIncomingTracking = Boolean(
    incoming.tid ||
    incoming.fbclid ||
    incoming.utm_source ||
    incoming.utm_medium ||
    incoming.utm_campaign ||
    incoming.utm_content ||
    incoming.utm_term,
  );

  // Decide os valores efetivos: "last touch" — incoming wins se trouxer algo;
  // senão herda do existente.
  const ex = (existing ?? {}) as Partial<ResolvedIdentity>;
  const effective: ResolvedIdentity = {
    tid:          (hasIncomingTracking ? incoming.tid          : null) ?? ex.tid          ?? null,
    fbclid:       (hasIncomingTracking ? incoming.fbclid       : null) ?? ex.fbclid       ?? null,
    utm_source:   (hasIncomingTracking ? incoming.utm_source   : null) ?? ex.utm_source   ?? null,
    utm_medium:   (hasIncomingTracking ? incoming.utm_medium   : null) ?? ex.utm_medium   ?? null,
    utm_campaign: (hasIncomingTracking ? incoming.utm_campaign : null) ?? ex.utm_campaign ?? null,
    utm_content:  (hasIncomingTracking ? incoming.utm_content  : null) ?? ex.utm_content  ?? null,
    utm_term:     (hasIncomingTracking ? incoming.utm_term     : null) ?? ex.utm_term     ?? null,
  };

  // Quando vem campanha nova, sobrescreve no DB. Quando não vem nada
  // novo, ainda atualiza last_bot_id e last_updated_at pra refletir
  // a atividade do lead, mas mantém o tracking existente.
  //
  // PERF: essas escritas NÃO alimentam o valor de retorno (`effective` já
  // está calculado acima), então não precisam bloquear a resposta ao lead.
  // Disparadas fire-and-forget: economiza um round-trip de DB no hot path
  // de toda mensagem que cria identidade / traz campanha nova / troca de bot.
  const nowIso = new Date().toISOString();
  const fireAndForget = (p: PromiseLike<unknown>): void => {
    Promise.resolve(p).then(
      () => {},
      (err) => console.error("[lead-identity] write falhou:", err),
    );
  };

  if (!existing) {
    fireAndForget(db.from("tenant_lead_identity").insert({
      tenant_id: tenantId,
      telegram_user_id: telegramUserId,
      tid: effective.tid,
      fbclid: effective.fbclid,
      utm_source: effective.utm_source,
      utm_medium: effective.utm_medium,
      utm_campaign: effective.utm_campaign,
      utm_content: effective.utm_content,
      utm_term: effective.utm_term,
      first_bot_id: botId,
      last_bot_id: botId,
      first_seen_at: nowIso,
      last_updated_at: nowIso,
    }));
  } else if (hasIncomingTracking) {
    // Campanha nova — sobrescreve atribuição
    fireAndForget(db
      .from("tenant_lead_identity")
      .update({
        tid: effective.tid,
        fbclid: effective.fbclid,
        utm_source: effective.utm_source,
        utm_medium: effective.utm_medium,
        utm_campaign: effective.utm_campaign,
        utm_content: effective.utm_content,
        utm_term: effective.utm_term,
        last_bot_id: botId,
        last_updated_at: nowIso,
      })
      .eq("tenant_id", tenantId)
      .eq("telegram_user_id", telegramUserId));
  } else if ((ex as { last_bot_id?: string }).last_bot_id !== botId) {
    // Sem campanha nova — só atualiza last_bot_id/last_updated_at, e SÓ
    // quando o bot mudou (#27). Lead voltando no mesmo bot (caso comum)
    // não gera write desnecessário. A atribuição de tracking não muda.
    fireAndForget(db
      .from("tenant_lead_identity")
      .update({ last_bot_id: botId, last_updated_at: nowIso })
      .eq("tenant_id", tenantId)
      .eq("telegram_user_id", telegramUserId));
  }

  return effective;
}
