"use client";

import { useEffect } from "react";

/**
 * Inicialização do Telegram Web App.
 *
 * Client component fino de propósito: o feed inteiro já veio renderizado do
 * servidor, e este componente só liga o SDK. Import dinâmico porque
 * @twa-dev/sdk toca em window no topo do módulo e quebraria o SSR.
 */
export function TelegramInit({ botId }: { botId: string }) {
  useEffect(() => {
    let cancelado = false;
    let disposeThemeListener: (() => void) | undefined;

    void (async () => {
      const WebApp = (await import("@twa-dev/sdk")).default;
      if (cancelado) return;

      const app = document.querySelector<HTMLElement>(".tg-app--fullscreen");
      const isIphone = WebApp.platform === "ios";
      app?.classList.toggle("tg-app--iphone", isIphone);
      app?.classList.toggle("tg-app--android", !isIphone);
      app?.setAttribute("data-telegram-platform", isIphone ? "iphone" : "android");

      const syncColorScheme = () => {
        document.documentElement.dataset.tgColorScheme =
          WebApp.colorScheme === "light" ? "light" : "dark";
      };
      syncColorScheme();
      WebApp.onEvent("themeChanged", syncColorScheme);
      disposeThemeListener = () => WebApp.offEvent("themeChanged", syncColorScheme);

      WebApp.ready();
      WebApp.expand();

      // Sem isso, o swipe pra baixo pra ler o feed FECHA o Mini App.
      WebApp.disableVerticalSwipes?.();

      // Faz a moldura nativa do Telegram combinar com o wrapper.
      try {
        WebApp.setHeaderColor("secondary_bg_color");
        WebApp.setBackgroundColor("bg_color");
      } catch {
        // Versões antigas do cliente não têm esses métodos. O feed continua
        // correto; só a moldura fica na cor padrão.
      }

      // Confirma no servidor que quem abriu veio mesmo de dentro do Telegram
      // (/api/mini/session valida o HMAC do initData). É deliberadamente
      // fire-and-forget: o feed já está pintado e NÃO pode depender disto —
      // esperar traria de volta a tela branca que o SSR existe pra evitar.
      // Rede caída ou 401 não muda nada na tela, e o catch existe pra não
      // deixar erro nenhum no console do lead.
      const initData = WebApp.initData;
      if (!initData) return; // aberto fora do Telegram: não há o que validar
      try {
        await fetch("/api/mini/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botId, initData }),
        });
      } catch {
        // Silêncio proposital.
      }
    })();

    return () => {
      cancelado = true;
      disposeThemeListener?.();
    };
  }, [botId]);

  return null;
}
