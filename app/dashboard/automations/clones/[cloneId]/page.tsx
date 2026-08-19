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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: job } = await supabase
    .from("clone_jobs")
    .select(
      "id, status, effective_strategy, dest_invite_link, total_seen, copied_count, skipped_count, failed_count, message_limit, last_error, source_title, dest_title",
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
          Progresso do clone
        </h1>
        <p className="text-(--text-secondary) text-sm mt-1">
          Acompanhe a cópia das mensagens em tempo real.
        </p>
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
