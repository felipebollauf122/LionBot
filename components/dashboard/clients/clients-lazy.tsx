"use client";

import dynamic from "next/dynamic";
import type { ClientsResult } from "@/lib/actions/client-actions";

/**
 * Client wrapper que carrega o ClientsView (chat + Realtime) só no cliente,
 * com ssr:false. Per docs do Next desta versão, ssr:false TEM que ficar dentro
 * de um Client Component. Isso garante que o bundle pesado do chat só baixa
 * quando esta aba é aberta — não pesa o resto do app.
 */
const ClientsView = dynamic(
  () => import("@/components/dashboard/clients/clients-view").then((m) => m.ClientsView),
  {
    ssr: false,
    loading: () => (
      <div className="h-full grid place-items-center">
        <span className="w-7 h-7 border-2 border-(--accent)/30 border-t-(--accent) rounded-full animate-spin" />
      </div>
    ),
  },
);

export function ClientsLazy({ botId, initial }: { botId: string; initial: ClientsResult }) {
  return <ClientsView botId={botId} initial={initial} />;
}
