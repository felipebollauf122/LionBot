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
    .from("bot_clone_jobs")
    .select(
      "id, status, target_bot_username, nodes_discovered, nodes_skipped, messages_captured, remarketing_deadline, remarketing_messages_captured, suspected_payment_hit, last_error, dest_flow_id, dest_bot_id, dest_remarketing_config_id",
    )
    .eq("id", cloneId)
    .eq("tenant_id", user.id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
