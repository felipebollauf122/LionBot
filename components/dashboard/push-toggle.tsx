"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, removePushSubscription } from "@/lib/actions/push-actions";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "working";

export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;
    const finish = (s: State) => { if (!settled) { settled = true; setState(s); } };
    // Rede de segurança: se a checagem travar (ex: SW que nunca resolve no iOS),
    // assume "off" em 3s pra o botão "Ativar" SEMPRE aparecer (nunca preso em loading).
    const timer = setTimeout(() => finish("off"), 3000);
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
        return finish(isIOS && !standalone ? "ios-install" : "unsupported");
      }
      if (Notification.permission === "denied") return finish("denied");
      try {
        // Registra o SW JÁ no carregamento (antes só registrava no enable()).
        // Sem isso, navigator.serviceWorker.ready TRAVAVA pra sempre e o toggle
        // nunca aparecia (ficava preso em "loading").
        let reg = await navigator.serviceWorker.getRegistration("/sw.js");
        if (!reg) reg = await navigator.serviceWorker.register("/sw.js");
        const existing = await reg.pushManager.getSubscription();
        finish(existing ? "on" : "off");
      } catch {
        finish("off");
      }
    })();
    return () => clearTimeout(timer);
  }, []);

  async function enable() {
    setError(null);
    setState("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePushSubscription(json, navigator.userAgent);
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao ativar");
      setState("off");
    }
  }

  async function disable() {
    setError(null);
    setState("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao desativar");
      setState("on");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-foreground font-medium text-sm">Notificações de venda</p>
          <p className="text-[11px] text-(--text-muted) mt-0.5">Receba um alerta neste dispositivo a cada venda aprovada.</p>
        </div>
        {(state === "on" || state === "off" || state === "working") && (
          <button
            onClick={state === "on" ? disable : enable}
            disabled={state === "working"}
            className={`toggle-btn ${state === "on" ? "on" : "off"} disabled:opacity-50`}
          >
            {state === "working" ? "..." : state === "on" ? "Ativado" : "Ativar"}
          </button>
        )}
      </div>

      {state === "ios-install" && (
        <div className="p-3 rounded-lg bg-(--cyan)/[0.06] border border-(--cyan)/20 text-[12px] text-(--text-secondary) leading-relaxed">
          📲 No iPhone, primeiro adicione o LionBot à tela inicial: toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>. Depois abra o app por lá e volte aqui para ativar.
        </div>
      )}
      {state === "denied" && (
        <div className="p-3 rounded-lg bg-(--red)/[0.06] border border-(--red)/20 text-[12px] text-(--red)">
          Permissão de notificação bloqueada. Reative nas configurações do navegador/dispositivo.
        </div>
      )}
      {state === "unsupported" && (
        <div className="p-3 rounded-lg bg-white/[0.03] border border-(--border-subtle) text-[12px] text-(--text-muted)">
          Este navegador não suporta notificações push.
        </div>
      )}
      {error && <p className="text-[11px] text-(--red)">{error}</p>}
    </div>
  );
}
