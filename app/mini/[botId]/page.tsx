import { notFound } from "next/navigation";
import { loadFeed } from "@/lib/social-proof/feed";
import { ChatBackdrop } from "@/components/telegram/chat-backdrop";
import { ChannelHeader } from "@/components/telegram/channel-header";
import { PinnedBar } from "@/components/telegram/pinned-bar";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import { ChannelFooter } from "@/components/telegram/channel-footer";
import { TelegramInit } from "./telegram-init";
import "@/components/telegram/theme.css";

/**
 * Mini App de prova social.
 *
 * force-dynamic porque o feed é relativo ao instante em que o lead abre: uma
 * resposta cacheada congelaria os horários. Válido porque cacheComponents está
 * desligado em next.config.ts — se alguém ligar, o Next 16 remove este export.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  // `absolute` porque o template do root layout é "%s · LionBot": um title
  // string viraria "Canal · LionBot" e entregaria a marca da plataforma
  // justamente na tela cujo propósito é parecer um canal do Telegram.
  title: { absolute: "Canal" },
  // Mini App não é página pra buscador: é destino de botão dentro do Telegram.
  robots: { index: false, follow: false },
};

export default async function MiniAppPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const feed = await loadFeed(botId);

  if (!feed) notFound();

  // Um único "agora" pra todas as mensagens: resolver offsets contra instantes
  // diferentes produziria horários incoerentes entre si.
  const now = new Date();

  return (
    <div className="tg-app tg-app--fullscreen">
      <TelegramInit botId={botId} />
      <ChatBackdrop />
      <ChannelHeader channel={feed.channel} />
      <PinnedBar text={feed.pinnedText} />
      <ChannelFeed messages={feed.messages} channel={feed.channel} now={now} />
      <ChannelFooter />
    </div>
  );
}
