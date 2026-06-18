import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { BotShell } from "@/components/dashboard/bot-shell";
import type { Bot } from "@/lib/types/database";

export default async function BotLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: bot } = await supabase
    .from("bots")
    .select("*")
    .eq("id", botId)
    .single();

  if (!bot) notFound();

  const typedBot = bot as Bot;

  return (
    <BotShell botId={botId} botUsername={typedBot.bot_username} avatarUrl={typedBot.avatar_url}>
      {children}
    </BotShell>
  );
}
