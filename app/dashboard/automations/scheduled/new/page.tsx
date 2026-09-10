import { notFound, redirect } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { createEmptyCampaign } from "../actions";

export const dynamic = "force-dynamic";

type SP = { [key: string]: string | string[] | undefined };

/**
 * Cria e redireciona: não há formulário a preencher, porque destino e
 * agendamento são editados na própria tela da campanha.
 */
export default async function NovaCampanhaPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  if (!(await canAccessAutomations())) notFound();
  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : undefined;

  const r = await createEmptyCampaign(view);
  if (!r.ok) notFound();
  // `redirect()` lança por dentro — fora de qualquer try/catch, senão o Next
  // trataria o redirecionamento como erro.
  redirect(`/dashboard/automations/scheduled/${r.campaignId}`);
}
