import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/actions/admin-actions";
import { isOwner } from "@/lib/actions/owner-actions";
import { BotSettingsForm } from "@/components/dashboard/bot-settings-form";
import { BlacklistManager } from "@/components/dashboard/blacklist-manager";
import { SettingsPasswordGate } from "@/components/dashboard/settings-password-gate";
import type { Bot, BlacklistUser } from "@/lib/types/database";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const supabase = await createClient();
  const admin = await isAdmin();
  const owner = await isOwner();

  const { data: bot } = await supabase
    .from("bots")
    .select("*")
    .eq("id", botId)
    .single();

  if (!bot) notFound();

  let blacklist: BlacklistUser[] = [];
  if (admin) {
    const { data } = await supabase
      .from("blacklist_users")
      .select("*")
      .eq("bot_id", botId)
      .order("created_at", { ascending: false });
    blacklist = (data ?? []) as BlacklistUser[];
  }

  return (
    <SettingsPasswordGate enabled={owner}>
      <div className="p-4 sm:p-6 lg:p-8 pb-20 md:pb-8 max-w-5xl mx-auto w-full">
        <BotSettingsForm bot={bot as Bot} isAdmin={admin}>
          {admin && <BlacklistManager botId={botId} initialBlacklist={blacklist} />}
        </BotSettingsForm>
      </div>
    </SettingsPasswordGate>
  );
}
