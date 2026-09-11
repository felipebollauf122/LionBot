"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLibraryEnabled, reprocessLibraryDrafts } from "@/app/dashboard/automations/scheduled/libraries/actions";
import type { LibraryResult } from "@/lib/automations/library-types";

export function LibraryControls({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message,setMessage] = useState<string|null>(null);
  function run(work: () => Promise<LibraryResult>) {
    setMessage(null);
    start(async () => { try { const result=await work(); if(!result.ok)setMessage(result.error);else router.refresh(); } catch {setMessage("Não foi possível concluir. Tente novamente.");} });
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <span className={`badge ${enabled?"badge-active":"badge-pending"}`}>{enabled?"Automação ativa":"Automação pausada"}</span>
      <button className={enabled?"btn-ghost":"btn-primary"} disabled={pending} onClick={()=>run(()=>setLibraryEnabled(id,!enabled))}>{pending?"Aguarde…":enabled?"Pausar automação":"Ativar automação"}</button>
    </div>
    {message&&<p role="alert" className="text-sm text-(--red)">{message}</p>}
  </div>;
}
export function ReprocessDrafts({ libraryId, disabled }: {libraryId:string;disabled:boolean}) {
  const [pending,start]=useTransition();
  const [message,setMessage]=useState("");
  return <div className="mt-8 space-y-2 border-t border-(--border-default) pt-6">
    <h2 className="font-semibold text-foreground">Aplicar as regras ao acervo existente</h2>
    <p className="text-sm text-(--text-secondary)">Reprocessa os rascunhos ainda não enfileirados. Mensagens já enviadas e seus originais são preservados.</p>
    <button className="btn-ghost" disabled={disabled||pending} onClick={()=>start(async()=>{const r=await reprocessLibraryDrafts(libraryId);setMessage(r.ok?"Rascunhos preparados. Ative a automação para processá-los.":r.error);})}>{pending?"Preparando…":"Reprocessar rascunhos"}</button>
    {message&&<p role="status" className="text-sm text-(--text-secondary)">{message}</p>}
  </div>;
}
