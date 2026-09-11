import { getLibraryContext } from "@/lib/automations/library-context";
import { LibraryControls } from "@/components/dashboard/automations/library-controls";
import { LibraryNavigation } from "@/components/dashboard/automations/library-navigation";
import { AutomationLink } from "@/components/dashboard/automations/scoped-link";
import { AutomationRefresh } from "@/components/dashboard/automations/refresh";
export default async function LibraryLayout({params,children}:{params:Promise<{libraryId:string}>;children:React.ReactNode}){
 const {libraryId}=await params;const {db,library}=await getLibraryContext(libraryId);
 const {data:dest}=library.dest_dialog_id?await db.from("mtproto_dialogs").select("title").eq("id",library.dest_dialog_id).maybeSingle():{data:null};
 return <section className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
  <AutomationRefresh active={library.enabled}/>
  <AutomationLink href="/dashboard/automations/scheduled" className="text-sm text-(--text-secondary) hover:text-foreground">Todas as postagens automáticas</AutomationLink>
  <header className="mb-6 mt-5 flex flex-wrap items-start justify-between gap-5">
   <div className="min-w-0"><h1 className="text-2xl font-semibold text-foreground md:text-3xl">{library.name}</h1><p className="mt-2 text-sm text-(--text-secondary)">Destino: {dest?.title||"Indisponível — sincronize a conta"}</p></div>
   <LibraryControls id={library.id} enabled={library.enabled}/>
  </header>
  {library.last_error&&<p role="alert" className="mb-6 break-words text-sm text-(--red)">{library.last_error}</p>}
  <LibraryNavigation id={library.id}/>
  {children}
 </section>;
}
