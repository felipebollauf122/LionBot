import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { AccountDialogs } from "@/components/dashboard/account-dialogs";

export default async function AccountDialogsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  if (!(await isOwner())) notFound();
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
    <div className="p-8 max-w-4xl">
      <a href="/dashboard/automations" className="text-white/40 hover:text-white text-sm">
        ← Voltar
      </a>
      <h1 className="text-2xl font-bold text-white mt-4">
        Conteúdo — {account.display_name || account.phone_number}
      </h1>
      <p className="text-white/50 text-sm mt-1 mb-6">
        Tudo que essa conta enxerga no Telegram. Canais e grupos podem ser clonados.
      </p>
      <AccountDialogs accountId={accountId} hasBot={Boolean(bot)} />
    </div>
  );
}
