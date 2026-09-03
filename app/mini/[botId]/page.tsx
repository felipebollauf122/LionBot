import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { loadFeed } from "@/lib/social-proof/feed";
import { ChatBackdrop } from "@/components/telegram/chat-backdrop";
import { ChannelHeader } from "@/components/telegram/channel-header";
import { PinnedBar } from "@/components/telegram/pinned-bar";
import { ChannelFeed } from "@/components/telegram/channel-feed";
import { ChannelFooter } from "@/components/telegram/channel-footer";
import { tgFontsClassName } from "@/components/telegram/fonts";
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

/*
 * Esquema de cores ANTES do primeiro paint.
 *
 * O Telegram passa o tema no hash da URL (tgWebAppThemeParams). Lê-lo aqui,
 * inline, evita o piscar entre o HTML do servidor (escuro) e o tema real do
 * usuário, que o SDK só aplica depois de carregar. A conta é a mesma que o
 * SDK usa para decidir colorScheme: luminância do bg_color abaixo de 120 é
 * escuro. Qualquer falha cai no silêncio — o SDK corrige logo depois.
 */
const SCHEME_SCRIPT = `try{var m=/tgWebAppThemeParams=([^&]+)/.exec(location.hash);if(m){var p=JSON.parse(decodeURIComponent(m[1]));var c=p&&p.bg_color;if(typeof c==="string"&&c.length===7){var r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),b=parseInt(c.slice(5,7),16);document.documentElement.dataset.tgScheme=Math.sqrt(0.299*r*r+0.587*g*g+0.114*b*b)<120?"dark":"light"}}}catch(e){}`;

export default async function MiniAppPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const feed = await loadFeed(botId);

  if (!feed) notFound();

  // A plataforma sai do User-Agent já no servidor, para o HTML nascer com o
  // layout certo em vez de pular de Android para iPhone quando o SDK carrega.
  // O SDK continua sendo a palavra final (TelegramInit corrige se divergir).
  const ua = (await headers()).get("user-agent") ?? "";
  const device = /iPhone|iPad|iPod/i.test(ua) ? "iphone" : "android";

  // Um único "agora" pra todas as mensagens: resolver offsets contra instantes
  // diferentes produziria horários incoerentes entre si.
  const now = new Date();

  const temFixada = feed.pinnedText.trim() !== "" || feed.pinnedMediaUrl !== null;
  const classes = [
    "tg-app",
    "tg-app--fullscreen",
    `tg-app--${device}`,
    temFixada ? "tg-app--has-pinned" : "",
    tgFontsClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SCHEME_SCRIPT }} />
      <div className={classes}>
        <TelegramInit botId={botId} />
        <ChatBackdrop />
        <div className="tg-platform-only--iphone">
          <ChannelHeader channel={feed.channel} device="iphone" />
        </div>
        <div className="tg-platform-only--android">
          <ChannelHeader channel={feed.channel} device="android" />
        </div>
        <PinnedBar text={feed.pinnedText} thumbUrl={feed.pinnedMediaUrl} />
        <ChannelFeed messages={feed.messages} channel={feed.channel} now={now} />
        <div className="tg-platform-only--iphone">
          <ChannelFooter device="iphone" />
        </div>
        <div className="tg-platform-only--android">
          <ChannelFooter device="android" />
        </div>
      </div>
    </>
  );
}
