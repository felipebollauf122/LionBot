"use client";
import { useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { addLibrarySource,setLibrarySourcePaused } from "@/app/dashboard/automations/scheduled/libraries/actions";
import type { LibraryDialog,LibrarySource } from "@/lib/automations/library-types";
// "Aguardando" sozinho lê como "processando". Com a automação pausada, o
// worker nem enxerga este acervo (repo.libraries filtra enabled=true), entao
// o rotulo precisa dizer o que realmente falta.
const labels:Record<string,string>={pending:"Na fila para coletar",importing:"Importando histórico",watching:"Escutando novas postagens",paused:"Pausada",failed:"Precisa de atenção",completed:"Histórico importado"};
export function LibrarySources({libraryId,sources,dialogs,enabled}:{libraryId:string;sources:LibrarySource[];dialogs:LibraryDialog[];enabled:boolean}){
 const router=useRouter();const [pending,start]=useTransition();const [error,setError]=useState("");const [adding,setAdding]=useState(false);
 const [dialog,setDialog]=useState("");const [history,setHistory]=useState(true);const [watch,setWatch]=useState(false);
 const rotulo=(status:string)=>!enabled&&status==="pending"?"Aguardando a automação ser ativada":labels[status]||status;
 return <div className="space-y-6">
  {!enabled&&<p role="status" className="rounded-lg border border-(--amber) bg-(--amber)/10 px-4 py-3 text-sm text-foreground">
   A automação está <strong>pausada</strong>: nada é coletado das origens enquanto ela estiver assim. Use <strong>Ativar automação</strong>, no topo desta tela, para começar a importar.
  </p>}
  <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-foreground">Origens de conteúdo</h2><p className="mt-2 max-w-2xl text-sm text-(--text-secondary)">Escolha canais ou grupos acessíveis à conta conectada. Eles podem pertencer a outras pessoas.</p></div><button className="btn-primary" onClick={()=>setAdding(!adding)}>{adding?"Fechar formulário":"Adicionar origem"}</button></div>
  {adding&&<form className="card max-w-3xl space-y-5 p-5" onSubmit={e=>{e.preventDefault();setError("");start(async()=>{const r=await addLibrarySource(libraryId,{dialogId:dialog,importHistory:history,watch});if(!r.ok)setError(r.error);else{setAdding(false);setDialog("");router.refresh();}});}}>
   <label className="block space-y-2"><span className="input-label">Canal ou grupo de origem</span><select className="input" required value={dialog} onChange={e=>setDialog(e.target.value)}><option value="">Selecione a origem</option>{dialogs.map(d=><option key={d.id} value={d.id}>{d.title} — {d.account}</option>)}</select></label>
   <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={history} onChange={e=>setHistory(e.target.checked)}/><span><span className="block text-sm font-medium text-foreground">Importar todo o histórico</span><span className="text-sm text-(--text-secondary)">Coletar mensagens e mídias existentes para o acervo, mantendo a ordem e os álbuns.</span></span></label>
   <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={watch} onChange={e=>setWatch(e.target.checked)}/><span><span className="block text-sm font-medium text-foreground">Escutar novas postagens</span><span className="text-sm text-(--text-secondary)">Cada nova postagem entra no acervo, passa pelas regras e segue o modo de publicação escolhido.</span></span></label>
   <button className="btn-primary" disabled={pending||!dialog||(!history&&!watch)}>{pending?"Adicionando…":"Adicionar ao acervo"}</button>
  </form>}
  {error&&<p role="alert" className="text-sm text-(--red)">{error}</p>}
  <p className="max-w-3xl text-sm leading-relaxed text-(--text-secondary)">A coleta começa ao ativar a automação e só acessa o conteúdo disponível à conta conectada. Arquivos de até 50 MB são guardados no armazenamento do projeto; formatos não suportados ficam sinalizados no acervo. A escuta prioriza novas postagens, mas o envio depende do tempo de resposta do Gemini e dos limites do Telegram.</p>
  {!sources.length?<p className="py-8 text-sm text-(--text-secondary)">Adicione sua primeira origem. Depois, configure as regras e ative a automação.</p>:<div className="divide-y divide-(--border-default)">{sources.map(s=><div key={s.id} className="flex flex-wrap items-start justify-between gap-4 py-5">
   <div className="min-w-0"><h3 className="font-medium text-foreground">{dialogs.find(d=>d.id===s.source_dialog_id)?.title||"Origem indisponível — sincronize a conta"}</h3><p className="mt-1 text-sm text-(--text-secondary)">{rotulo(s.status)} · {s.imported_count} mensagens no acervo</p><p className="mt-1 text-xs text-(--text-muted)">{s.import_history?"Histórico completo":""}{s.import_history&&s.watch?" + ":""}{s.watch?"Novas postagens":""}</p>{s.last_error&&<p className="mt-2 max-w-2xl break-words text-sm text-(--red)">{s.last_error}</p>}</div>
   <button disabled={pending} className="btn-ghost" onClick={()=>start(async()=>{const r=await setLibrarySourcePaused(libraryId,s.id,!["paused","failed"].includes(s.status));if(!r.ok)setError(r.error);else router.refresh();})}>{["paused","failed"].includes(s.status)?"Retomar origem":"Pausar origem"}</button>
  </div>)}</div>}
 </div>;
}
