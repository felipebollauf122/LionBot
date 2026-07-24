import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { CloneForm } from "@/components/dashboard/clone-form";

export default async function NewClonePage({
  searchParams,
}: {
  searchParams: Promise<{ dialogId?: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { dialogId } = await searchParams;
  if (!dialogId) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: dialog } = await supabase
    .from("mtproto_dialogs")
    .select("id, title, kind, account_id, mtproto_accounts!inner(tenant_id)")
    .eq("id", dialogId)
    .eq("mtproto_accounts.tenant_id", user.id)
    .single();
  if (!dialog) notFound();

  // Contas que podem CRIAR o destino: ativas e não-restritas. A conta da
  // origem entra na lista só se ela mesma puder criar (não estiver restrita).
  const { data: eligible } = await supabase
    .from("mtproto_accounts")
    .select("id, display_name, phone_number")
    .eq("tenant_id", user.id)
    .eq("status", "active")
    .eq("create_restricted", false)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8 max-w-2xl">
      <a href="/dashboard/automations" className="text-white/40 hover:text-white text-sm">
        ← Voltar
      </a>
      <h1 className="text-2xl font-bold text-white mt-4">Clonar</h1>
      <p className="text-white/50 text-sm mt-1 mb-6">
        Origem: <strong className="text-white/80">{dialog.title}</strong>
      </p>
      <CloneForm
        dialogId={dialog.id}
        sourceTitle={dialog.title ?? "Clone"}
        sourceAccountId={dialog.account_id}
        destAccounts={(eligible ?? []).map((a) => ({
          id: a.id,
          label: a.display_name || a.phone_number,
        }))}
      />
    </div>
  );
}
