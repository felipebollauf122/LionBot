import { notFound } from "next/navigation";
import { getLibraryContext } from "@/lib/automations/library-context";
import { LibrarySources } from "@/components/dashboard/automations/library-sources";
import { LibraryRulesForm } from "@/components/dashboard/automations/library-rules";
import { AutomationLink } from "@/components/dashboard/automations/scoped-link";
import { listLibraryDialogs } from "../../actions";
import type { LibraryItem,LibrarySource } from "@/lib/automations/library-types";
import type { AutomationSearchParams } from "@/lib/automations/navigation";
const statuses:Record<string,string>={pending:"Na fila",processing:"Tratando com Gemini",ready:"Pronta para revisão",skipped:"Filtrada / parte de álbum",failed:"Precisa de atenção",draft:"Rascunho",sending:"Aguardando confirmação de envio",sent:"Enviada"};
export default async function LibraryTabPage({params,searchParams}:{params:Promise<{libraryId:string;tab:string}>;searchParams:Promise<AutomationSearchParams>}){
 const {libraryId,tab}=await params;
 if(!["items","sources","rules","queue"].includes(tab))notFound();
 const {db,library}=await getLibraryContext(libraryId);
 if(tab==="rules")return <LibraryRulesForm libraryId={libraryId} initial={library.rules} enabled={library.enabled}/>;
 if(tab==="sources"){
  const [result,dialogs]=await Promise.all([db.from("automation_library_sources").select("*").eq("library_id",libraryId).order("created_at"),listLibraryDialogs(library.tenant_id)]);
  if(result.error)throw new Error("Não foi possível carregar as origens.");
  return <LibrarySources libraryId={libraryId} sources={(result.data??[]) as LibrarySource[]} dialogs={dialogs.filter(d=>d.id!==library.dest_dialog_id)} enabled={library.enabled}/>;
 }
 const sp=await searchParams;const rawPage=typeof sp.page==="string"?Number(sp.page):1;
 const page=Number.isSafeInteger(rawPage)&&rawPage>0?rawPage:1;
 const queue=tab==="queue";const size=40;
 let query=db.from("automation_library_items").select("*",{count:"exact"}).eq("library_id",libraryId).order("created_at",{ascending:false}).order("id").range((page-1)*size,page*size-1);
 if(queue)query=query.in("delivery_status",["pending","sending","sent","failed"]);
 const {data,error,count}=await query;if(error)throw new Error("Não foi possível carregar as mensagens.");
 const items=(data??[]) as LibraryItem[];
 return <div>
  <div className="mb-6"><h2 className="text-xl font-semibold text-foreground">{queue?"Fila de publicação":"Acervo de mensagens e mídias"}</h2><p className="mt-2 text-sm text-(--text-secondary)">{queue?"Acompanhe postagens agendadas, enviadas e as que precisam de atenção.":"Os originais ficam guardados aqui, inclusive depois de publicados. Abra um item para revisar, editar ou reutilizar."} {count??0} itens.</p></div>
  {!items.length?<div className="space-y-4 py-8 text-sm text-(--text-secondary)"><p>{queue?"Nenhuma publicação nesta fila. Revise um item do acervo ou escolha um modo automático nas regras.":"O acervo ainda está vazio. Adicione uma origem e ative a automação para importar o conteúdo."}</p><AutomationLink href={`/dashboard/automations/scheduled/libraries/${libraryId}/${queue?"items":"sources"}`} className="btn-ghost">{queue?"Abrir acervo":"Escolher origens"}</AutomationLink></div>:<div className="divide-y divide-(--border-default)">
  {items.map(item=><AutomationLink key={item.id} href={`/dashboard/automations/scheduled/libraries/${libraryId}/items/${item.id}`} className="block rounded-lg px-3 py-5 hover:bg-(--bg-hover)">
   <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium text-foreground">{item.original.kind} · mensagem {item.source_message_id}</span><span className="text-xs text-(--text-secondary)">{queue?statuses[item.delivery_status]:statuses[item.status]}</span></div>
   <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-(--text-secondary)">{(item.processed??item.original).content_text||item.original.poll?.question||`${item.original.media?.length??0} arquivo(s) de mídia`}</p>
   {item.scheduled_at&&<p className="mt-2 text-xs text-(--text-muted)">Agendada: {new Date(item.scheduled_at).toLocaleString("pt-BR",{timeZone:library.rules.timezone})}</p>}
   {item.last_error&&!item.last_error.startsWith("album_member:")&&<p className="mt-2 line-clamp-2 text-sm text-(--red)">{item.last_error}</p>}
  </AutomationLink>)}</div>}
  <div className="mt-8 flex items-center justify-between gap-4 text-sm text-(--text-secondary)">{page>1?<AutomationLink className="btn-ghost" href={`/dashboard/automations/scheduled/libraries/${libraryId}/${tab}?page=${page-1}`}>Anterior</AutomationLink>:<span/>}<span>Página {page}</span>{page*size<(count??0)?<AutomationLink className="btn-ghost" href={`/dashboard/automations/scheduled/libraries/${libraryId}/${tab}?page=${page+1}`}>Próxima</AutomationLink>:<span/>}</div>
 </div>;
}
