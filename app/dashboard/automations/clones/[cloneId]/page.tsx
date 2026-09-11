import { AutomationLink } from "@/components/dashboard/automations/scoped-link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { CloneProgress } from "@/components/dashboard/clone-progress";
import { CardShell } from "@/components/dashboard/analytics/card-shell";
import { icons } from "@/components/dashboard/analytics/icons";

export default async function ClonePage({
  params,
}: {
  params: Promise<{ cloneId: string }>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const { cloneId } = await params;
  const supabase = await createClient();

  // Sem filtro de tenant_id — RLS de clone_jobs cobre (próprio ou, se admin, qualquer tenant).
  const { data: job } = await supabase
    .from("clone_jobs")
    .select(
      "id, status, effective_strategy, dest_invite_link, total_seen, copied_count, skipped_count, failed_count, message_limit, last_error, source_title, dest_title, mode, draft_campaign_id",
    )
    .eq("id", cloneId)
    .single();
  if (!job) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <AutomationLink
        href="/dashboard/automations/clones"
        className="text-(--text-muted) hover:text-foreground text-sm transition-colors"
      >
        ← Voltar
      </AutomationLink>
      <header className="mt-3 mb-6 reveal flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
            Progresso do clone
          </h1>
          <p className="text-(--text-secondary) text-sm mt-1">
            Acompanhe a cópia das mensagens em tempo real.
          </p>
        </div>
        {/* Clone no modo rascunho não publica: ele enche uma campanha, que é
            editada e agendada na tela dela. */}
        {job.mode === "draft" && job.draft_campaign_id && (
          <AutomationLink
            href={`/dashboard/automations/scheduled/${job.draft_campaign_id}`}
            className="btn-primary text-xs px-4 py-2"
          >
            Abrir rascunho
          </AutomationLink>
        )}
      </header>
      <CardShell
        title={job.dest_title}
        subtitle={`de ${job.source_title ?? "—"}`}
        icon={icons.flow}
        accent="magenta"
      >
        <CloneProgress initial={job} />
      </CardShell>
    </div>
  );
}
