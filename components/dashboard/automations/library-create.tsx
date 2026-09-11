"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLibrary } from "@/app/dashboard/automations/scheduled/libraries/actions";
import { automationHref } from "@/lib/automations/navigation";
import type { LibraryDialog } from "@/lib/automations/library-types";

export function LibraryCreate({dialogs,tenantId,view}:{dialogs:LibraryDialog[];tenantId:string;view:string}){
 const router=useRouter();const lock=useRef(false);const [pending,start]=useTransition();
 const [name,setName]=useState("");const [dest,setDest]=useState("");const [error,setError]=useState("");
 return <form className="card max-w-2xl space-y-6 p-6" onSubmit={e=>{e.preventDefault();if(lock.current)return;lock.current=true;setError("");start(async()=>{try{
  const result=await createLibrary({name,destDialogId:dest,actingTenantId:tenantId});
  if(!result.ok){setError(result.error);lock.current=false;return;}
  router.push(automationHref(`/dashboard/automations/scheduled/libraries/${result.id}/sources`,view));
 }catch{setError("Não foi possível criar o acervo.");lock.current=false;}});}}>
  <label className="block space-y-2"><span className="input-label">Nome da automação</span><input className="input" value={name} onChange={e=>setName(e.target.value)} maxLength={120} required placeholder="Ex.: Conteúdo do meu canal"/></label>
  <label className="block space-y-2"><span className="input-label">Canal ou grupo onde publicar</span><select className="input" required value={dest} onChange={e=>setDest(e.target.value)}><option value="">Escolha o destino</option>{dialogs.map(d=><option key={d.id} value={d.id}>{d.title} — {d.account}</option>)}</select></label>
  <p className="text-sm text-(--text-secondary)">O acervo fica vinculado a este destino. A automação começa pausada, com revisão antes de publicar.</p>
  <p className="text-sm text-(--text-secondary)">Adicione seu bot de publicação como administrador do destino, com permissão para enviar mensagens. A conta conectada faz a coleta; o bot faz a publicação.</p>
  {!dialogs.length&&<p className="text-sm text-(--amber)">Conecte e sincronize uma conta administradora do seu canal ou grupo na tela Contas Telegram.</p>}
  {error&&<p role="alert" className="text-sm text-(--red)">{error}</p>}
  <button className="btn-primary" disabled={pending||!name.trim()||!dest}>{pending?"Criando…":"Criar acervo e escolher origens"}</button>
 </form>;
}
