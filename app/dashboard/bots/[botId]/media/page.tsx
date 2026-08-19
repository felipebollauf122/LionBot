import { createClient } from "@/lib/supabase/server";
import { MediaList } from "@/components/dashboard/media-list";
import type { MediaAsset } from "@/lib/types/database";

export default async function MediaPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const supabase = await createClient();

  const { data: assets } = await supabase
    .from("media_assets")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false });

  return (
    <div className="p-8">
      <MediaList
        botId={botId}
        initialAssets={(assets ?? []) as MediaAsset[]}
      />
    </div>
  );
}
