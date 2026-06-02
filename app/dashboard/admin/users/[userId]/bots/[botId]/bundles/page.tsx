import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { BundleList } from "@/components/dashboard/bundle-list";

export default async function AdminBotBundlesPage({
  params,
}: {
  params: Promise<{ userId: string; botId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { botId } = await params;
  const supabase = await createClient();

  const { data: bundles } = await supabase
    .from("product_bundles")
    .select("*, product_bundle_items(*, products(id, name, ghost_name, price, currency, is_active))")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false });

  const { data: products } = await supabase
    .from("products")
    .select("id, name, ghost_name, price, currency, is_active")
    .eq("bot_id", botId)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="p-8">
      <BundleList
        botId={botId}
        initialBundles={(bundles ?? []) as any}
        products={(products ?? []) as any}
        isAdmin={true}
      />
    </div>
  );
}
