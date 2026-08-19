import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { AccountDialogs } from "@/components/dashboard/account-dialogs";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function AccountDialogsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { accountId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: account } = await supabase
    .from("mtproto_accounts")
    .select("id, display_name, phone_number")
    .eq("id", accountId)
    .eq("tenant_id", user.id)
    .single();
  if (!account) notFound();

  const { data: bot } = await supabase
    .from("automation_bots")
    .select("username")
    .eq("tenant_id", user.id)
    .maybeSingle();

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <a
        href="/dashboard/automations"
        className="text-(--text-muted) hover:text-foreground text-sm transition-colors"
      >
        ← Voltar
      </a>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
          Conteúdo — {account.display_name || account.phone_number}
        </h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Tudo que essa conta enxerga no Telegram. Canais e grupos podem ser clonados.
        </p>
      </header>
      <CardShell title="Conteúdo da conta" subtitle="canais, grupos, bots e contatos" icon={icons.users} accent="purple">
        <AccountDialogs accountId={accountId} hasBot={Boolean(bot)} />
      </CardShell>
    </div>
  );
}
