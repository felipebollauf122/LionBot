import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/actions/admin-actions";
import { BotShell } from "@/components/dashboard/bot-shell";
import type { Bot } from "@/lib/types/database";

export default async function AdminBotLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ userId: string; botId: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect("/dashboard");

  const { userId, botId } = await params;
  const supabase = await createClient();

  const { data: bot } = await supabase
    .from("bots")
    .select("*")
    .eq("id", botId)
    .eq("tenant_id", userId)
    .single();

  if (!bot) notFound();

  const typedBot = bot as Bot;

  return (
    <BotShell
      botId={botId}
      botUsername={typedBot.bot_username}
      avatarUrl={typedBot.avatar_url}
      basePath={`/dashboard/admin/users/${userId}/bots/${botId}`}
    >
      {children}
    </BotShell>
  );
}
