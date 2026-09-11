import { cache } from "react";
import { notFound } from "next/navigation";
import { canAccessAutomations } from "@/lib/actions/automations-access-actions";
import { createClient } from "@/lib/supabase/server";
import { defaultLibraryRules,type AutomationLibrary } from "./library-types";

export const getLibraryContext=cache(async(id:string)=>{
 if(!await canAccessAutomations())notFound();
 const db=await createClient();
 const {data,error}=await db.from("automation_libraries").select("*").eq("id",id).maybeSingle();
 if(error)throw new Error("Não foi possível carregar o acervo.");
 if(!data)notFound();
 const library={...data,rules:{...defaultLibraryRules,...data.rules}} as AutomationLibrary;
 return {db,library};
});
