import { createClient } from "@/lib/supabase/server";
import { ProfileView } from "@/components/dashboard/profile-view";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // nome editável vem de tenants.name; fallback: metadata → handle do email.
  let dbName = "";
  if (user) {
    const { data: tenant } = await supabase.from("tenants").select("name").eq("id", user.id).single();
    dbName = (tenant?.name as string | undefined)?.trim() ?? "";
  }
  const meta = (user?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const name = dbName || meta.name || meta.full_name || (user?.email ? user.email.split("@")[0] : "");

  return <ProfileView name={name} email={user?.email ?? ""} />;
}
