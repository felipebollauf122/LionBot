import { createClient } from "@/lib/supabase/server";
import { BundleList } from "@/components/dashboard/bundle-list";
import { isAdmin } from "@/lib/actions/admin-actions";

export default async function BundlesPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const supabase = await createClient();
  const admin = await isAdmin();

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
        isAdmin={admin}
      />
    </div>
  );
}
