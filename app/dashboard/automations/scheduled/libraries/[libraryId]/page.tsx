import { redirect } from "next/navigation";
import { automationHref,type AutomationSearchParams } from "@/lib/automations/navigation";
export default async function LibraryPage({params,searchParams}:{params:Promise<{libraryId:string}>;searchParams:Promise<AutomationSearchParams>}){
 const {libraryId}=await params;const sp=await searchParams;
 redirect(automationHref(`/dashboard/automations/scheduled/libraries/${libraryId}/items`,typeof sp.view==="string"?sp.view:undefined));
}
