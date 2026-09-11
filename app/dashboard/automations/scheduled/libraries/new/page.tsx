import { AutomationSectionPage } from "@/components/dashboard/automations/section-page";
import { LibraryCreate } from "@/components/dashboard/automations/library-create";
import { getAutomationPageContext } from "@/lib/automations/page-context";
import type { AutomationSearchParams } from "@/lib/automations/navigation";
import { listLibraryDialogs } from "../actions";
export default async function NewLibraryPage({searchParams}:{searchParams:Promise<AutomationSearchParams>}){
 const context=await getAutomationPageContext(searchParams);
 const dialogs=context.canCreate?await listLibraryDialogs(context.actingTenantId,true):[];
 return <AutomationSectionPage title="Nova postagem automática" description="Escolha o destino para criar seu acervo de conteúdo e suas regras de publicação." context={context}>{context.canCreate&&context.actingTenantId?<LibraryCreate dialogs={dialogs} tenantId={context.actingTenantId} view={context.view}/>:<p className="text-sm text-(--text-secondary)">Selecione um usuário para continuar.</p>}</AutomationSectionPage>;
}
