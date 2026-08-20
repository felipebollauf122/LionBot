import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { MtprotoInbox } from "@/components/dashboard/mtproto-inbox";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { accountId } = await params;
  const supabase = await createClient();

  // Sem filtro de tenant_id — RLS de mtproto_accounts cobre (própria conta
  // ou, se admin, qualquer tenant, espelhando o seletor Minha/Todos/Usuário
  // da lista em /dashboard/automations).
  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id, display_name, phone_number, status")
    .eq("id", accountId)
    .single();
  if (!account) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <a href="/dashboard/automations" className="text-(--text-muted) hover:text-foreground text-sm transition-colors">
        ← Voltar
      </a>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
          Mensagens — {account.display_name || account.phone_number}
        </h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Mensagens recebidas da conta oficial &quot;Telegram&quot; (códigos de login,
          alertas de segurança). Retenção de 7 dias.
        </p>
      </header>
      <CardShell title="Mensagens" subtitle="Telegram oficial" icon={icons.clock} accent="cyan">
        <MtprotoInbox accountId={accountId} />
      </CardShell>
    </div>
  );
}
