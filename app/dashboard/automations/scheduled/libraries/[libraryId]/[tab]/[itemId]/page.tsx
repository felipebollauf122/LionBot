import { notFound } from "next/navigation";
import { getLibraryContext } from "@/lib/automations/library-context";
import { LibraryItemEditor } from "@/components/dashboard/automations/library-item-editor";
import type { LibraryItem } from "@/lib/automations/library-types";
export default async function LibraryItemPage({params}:{params:Promise<{libraryId:string;tab:string;itemId:string}>}){
  const {libraryId,tab,itemId}=await params;
  if(tab!=="items")notFound();
  const {db,library}=await getLibraryContext(libraryId);
  const {data,error}=await db.from("automation_library_items").select("*").eq("id",itemId).eq("library_id",libraryId).maybeSingle();
  if(error)throw new Error("Não foi possível carregar a mensagem.");
  if(!data)notFound();
  return <LibraryItemEditor key={data.id+data.status+data.delivery_status} item={data as LibraryItem} enabled={library.enabled}/>;
}
