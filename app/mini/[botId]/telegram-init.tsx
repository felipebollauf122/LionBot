"use client";

import { useEffect } from "react";

/**
 * Inicialização do Telegram Web App.
 *
 * Client component fino de propósito: o feed inteiro já veio renderizado do
 * servidor, e este componente só liga o SDK. Import dinâmico porque
 * @twa-dev/sdk toca em window no topo do módulo e quebraria o SSR.
 */
export function TelegramInit() {
  useEffect(() => {
    let cancelado = false;

    void (async () => {
      const WebApp = (await import("@twa-dev/sdk")).default;
      if (cancelado) return;

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
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  return null;
}
