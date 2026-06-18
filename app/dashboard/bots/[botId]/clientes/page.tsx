import { getClients } from "@/lib/actions/client-actions";
import { ClientsLazy } from "@/components/dashboard/clients/clients-lazy";

/**
 * Aba CLIENTES — só roda quando o usuário abre esta rota (Next só renderiza a
 * página da rota ativa). O server component busca a 1ª página; a UI de chat
 * (client component pesado: Realtime, composer) entra via dynamic/ssr:false,
 * então nada do chat carrega no resto do app.
 */
export default async function ClientesPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  const initial = await getClients(botId, { page: 1 });

  // Altura fixa do viewport (menos a bottom-bar no mobile) pra o chat ocupar a
  // tela toda com a lista e a conversa rolando internamente.
  return (
    <div className="h-[calc(100dvh-4rem)] md:h-screen">
      <ClientsLazy botId={botId} initial={initial} />
    </div>
  );
}
