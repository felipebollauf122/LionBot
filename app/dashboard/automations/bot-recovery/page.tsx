import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import { listActiveAccounts } from "@/app/dashboard/automations/actions";
import { BotRecoveryPanel } from "@/components/dashboard/bot-recovery-panel";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";

export default async function BotRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<AutomationSearchParams>;
}) {
  // O gate de premium é o layout de Automações (`canAccessAutomations`), que
  // chama notFound() — quem perde o plano não vê nem a tela. A rota interna
  // confere o plano de novo, porque o painel pode estar em cache.
  const context = await getAutomationPageContext(searchParams);

  let query = context.supabase
    .from("bots")
    .select("id,bot_username,is_active")
    .order("created_at", { ascending: false })
    .limit(200);
  if (context.scope.tenantId) query = query.eq("tenant_id", context.scope.tenantId);

  const [bots, contas] = await Promise.all([
    query,
    // Uma falha aqui não pode virar "nenhuma conta conectada" na tela: seria
    // mandar o usuário reconectar uma conta que já existe.
    listActiveAccounts(context.actingTenantId).then(
      (data) => ({ ok: true as const, data }),
      () => ({ ok: false as const, data: [] }),
    ),
  ]);

  return (
    <AutomationSectionPage
      title="Recuperação de bots"
      description="Se o Telegram derrubar um bot seu, uma conta conectada conversa com o BotFather, cria o substituto e restaura nome, descrição e foto. Leads, vendas e fluxos continuam no mesmo lugar."
      context={context}
    >
      {bots.error || !contas.ok ? (
        <p role="alert" className="py-8 text-sm leading-relaxed text-(--red)">
          Não foi possível carregar seus bots e contas agora. Atualize a página; se persistir,
          confira a conexão com o banco e se a migração 076 foi aplicada.
        </p>
      ) : !context.canCreate ? (
        // No modo "Todos" não há um dono definido: as contas do Telegram
        // listadas seriam as do admin, e o worker recusaria cada uma delas
        // como `account_not_owned_by_tenant`. Configurar exige um dono.
        <p className="py-8 text-sm leading-relaxed text-(--text-secondary)">
          A recuperação é configurada por dono, porque usa as contas do Telegram dele para
          falar com o BotFather. Selecione Minha ou um usuário acima para configurar.
        </p>
      ) : (
        <BotRecoveryPanel
          bots={bots.data ?? []}
          accounts={contas.data}
          actingTenantId={context.actingTenantId}
        />
      )}
    </AutomationSectionPage>
  );
}
