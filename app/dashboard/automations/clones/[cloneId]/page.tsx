import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/actions/owner-actions";
import { CloneProgress } from "@/components/dashboard/clone-progress";

export default async function ClonePage({
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
    .from("clone_jobs")
    .select(
      "id, status, effective_strategy, dest_invite_link, total_seen, copied_count, skipped_count, failed_count, message_limit, last_error, source_title, dest_title",
    )
    .eq("id", cloneId)
    .eq("tenant_id", user.id)
    .single();
  if (!job) notFound();

  return (
    <div className="p-8 max-w-2xl">
      <a href="/dashboard/automations" className="text-white/40 hover:text-white text-sm">
        ← Voltar
      </a>
      <h1 className="text-2xl font-bold text-white mt-4">{job.dest_title}</h1>
      <p className="text-white/50 text-sm mt-1 mb-6">
        Clonando de <strong className="text-white/80">{job.source_title}</strong>
      </p>
      <CloneProgress initial={job} />
    </div>
  );
}
