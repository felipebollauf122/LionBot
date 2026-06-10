import { createClient } from "@/lib/supabase/server";
import { ProfileView } from "@/components/dashboard/profile-view";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const meta = (user?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const name = meta.name || meta.full_name || (user?.email ? user.email.split("@")[0] : "");

  return <ProfileView name={name} email={user?.email ?? ""} />;
}
