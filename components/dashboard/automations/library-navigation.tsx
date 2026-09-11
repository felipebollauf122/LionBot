"use client";
import { usePathname } from "next/navigation";
import { AutomationLink } from "./scoped-link";
const tabs=[["items","Acervo"],["sources","Origens"],["rules","Regras do Gemini"],["queue","Fila de publicação"]] as const;
export function LibraryNavigation({id}:{id:string}){
 const path=usePathname();
 return <nav aria-label="Configuração da postagem automática" className="mb-8 flex flex-wrap gap-2 border-b border-(--border-default) pb-4">{tabs.map(([key,label])=><AutomationLink key={key} href={`/dashboard/automations/scheduled/libraries/${id}/${key}`} aria-current={path.includes(`/${id}/${key}`)?"page":undefined} className={`rounded-lg px-3 py-2.5 text-sm font-medium ${path.includes(`/${id}/${key}`)?"bg-(--accent-muted) text-(--accent)":"text-(--text-secondary) hover:bg-(--bg-hover)"}`}>{label}</AutomationLink>)}</nav>;
}
