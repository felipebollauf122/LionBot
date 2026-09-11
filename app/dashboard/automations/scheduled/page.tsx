import Link from "next/link";
import { AutomationRefresh } from "@/components/dashboard/automations/refresh";
import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";

export const dynamic = "force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<AutomationSearchParams>}) {
  const context=await getAutomationPageContext(searchParams);
  let query=context.supabase.from("automation_libraries").select("id,name,enabled,last_error,mtproto_dialogs(title)").order("created_at",{ascending:false}).limit(200);
  if(context.scope.tenantId) query=query.eq("tenant_id",context.scope.tenantId);
  const {data,error}=await query;
  return <AutomationSectionPage title="Postagem automática" description="Um acervo para cada destino. Importe o histórico, escute novas postagens e aplique suas regras antes de publicar." context={context} action={{label:"Nova automação",href:"/dashboard/automations/scheduled/libraries/new"}}>
    <AutomationRefresh active={(data??[]).some(row=>row.enabled)}/>
    {error?<p role="alert" className="py-8 text-sm text-(--red)">Não foi possível carregar os acervos. Confira a conexão e se a migração 077 foi aplicada ao banco.</p>:!data?.length?<div className="max-w-2xl space-y-4 py-8">
      <h2 className="text-xl font-semibold text-foreground">Comece pelo canal que vai receber as postagens</h2>
      <p className="text-sm leading-relaxed text-(--text-secondary)">Depois, escolha as origens e configure o Gemini. Acervo, origens, regras e fila têm telas próprias. A automação começa pausada e no modo de revisão.</p>
    </div>:<div className="divide-y divide-(--border-default)">{data.map(row=>{
      const dest=Array.isArray(row.mtproto_dialogs)?row.mtproto_dialogs[0]:row.mtproto_dialogs;
      return <Link key={row.id} href={context.href(`/dashboard/automations/scheduled/libraries/${row.id}/items`)} className="block rounded-lg px-3 py-5 hover:bg-(--bg-hover)">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-foreground">{row.name}</h2><span className="text-sm text-(--text-secondary)">{row.enabled?"Ativa":"Pausada"}</span></div>
        <p className="mt-2 text-sm text-(--text-secondary)">Destino: {dest?.title||"Indisponível — sincronize a conta"}</p>
        {row.last_error&&<p className="mt-2 text-sm text-(--red)">{row.last_error}</p>}
      </Link>;
    })}</div>}
    <aside className="mt-10 border-t border-(--border-default) pt-6 text-sm text-(--text-secondary)">
      <p>Quer montar uma sequência de mensagens manualmente? Suas campanhas anteriores continuam disponíveis.</p>
      <Link href={context.href("/dashboard/automations/scheduled/campaigns")} className="btn-ghost mt-3">Abrir campanhas manuais</Link>
    </aside>
  </AutomationSectionPage>;
}
