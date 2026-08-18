import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { BotCloneProgress } from "@/components/dashboard/bot-clone-progress";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function BotClonePage({
  params,
}: {
  params: Promise<{ cloneId: string }>;
}) {
  if (!(await isOwner())) notFound();
  const { cloneId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: job } = await supabase
    .from("bot_clone_jobs")
    .select(
      "id, status, target_bot_username, nodes_discovered, nodes_skipped, messages_captured, remarketing_messages_captured, suspected_payment_hit, last_error, dest_flow_id, dest_bot_id, dest_remarketing_config_id",
    )
    .eq("id", cloneId)
    .eq("tenant_id", user.id)
    .single();
  if (!job) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <a
        href="/dashboard/automations"
        className="text-(--text-muted) hover:text-foreground text-sm transition-colors"
      >
        ← Voltar
      </a>
      <header className="mt-3 mb-6 reveal">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
          Progresso da clonagem
        </h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Acompanhe a exploração do bot-alvo em tempo real.
        </p>
      </header>
      <CardShell
        title={`@${job.target_bot_username}`}
        subtitle="clonagem de bot"
        icon={icons.flow}
        accent="magenta"
      >
        <BotCloneProgress initial={job} />
      </CardShell>
    </div>
  );
}
