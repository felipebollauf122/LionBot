import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cloneId: string }> },
) {
  const { cloneId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("clone_jobs")
    .select(
      "id, status, effective_strategy, dest_invite_link, total_seen, copied_count, skipped_count, failed_count, message_limit, last_error",
    )
    .eq("id", cloneId)
    .eq("tenant_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
