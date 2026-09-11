"use client";
import { useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLibraryItem,resolveLibraryDelivery } from "@/app/dashboard/automations/scheduled/libraries/actions";
import type { LibraryItem } from "@/lib/automations/library-types";
import { AutomationLink } from "./scoped-link";

export function LibraryItemEditor({item,enabled}:{item:LibraryItem;enabled:boolean}) {
  const content=item.processed??item.original;
  const [text,setText]=useState(content.content_text??"");
  const [buttons,setButtons]=useState(content.buttons??content.inline_links??[]);
  const [scheduled,setScheduled]=useState("");
  const [ack,setAck]=useState(false);
  const [pending,start]=useTransition();
  const [feedback,setFeedback]=useState("");
  const router=useRouter();
  const albumLeader=item.last_error?.startsWith("album_member:")?item.last_error.slice(13):null;
  const receipts=item.delivery_receipts??[];
  const partial=receipts.length>0&&item.delivery_status!=="sent";
  const locked=!!albumLeader||pending||item.status==="processing"||item.delivery_status==="sending"||item.delivery_status==="sent"||partial;
  function perform(action:"save"|"queue"|"reprocess"|"reuse"|"discard"|"retry"){
    setFeedback("");
    start(async()=>{try{
      const result=await updateLibraryItem(item.library_id,item.id,{action,text,buttons,scheduledAt:scheduled?new Date(scheduled).toISOString():undefined});
      setFeedback(result.ok?"Alteração salva.":result.error);
      if(result.ok)router.refresh();
    }catch{setFeedback("Não foi possível salvar. Tente novamente.");}});
  }
  function resolve(outcome:"sent"|"retry"){
    start(async()=>{try{const result=await resolveLibraryDelivery(item.library_id,item.id,outcome);
      setFeedback(result.ok?"Conferência registrada.":result.error);if(result.ok)router.refresh();
    }catch{setFeedback("Não foi possível registrar. Tente novamente.");}});
  }
  return <div className="max-w-3xl space-y-8">
    <AutomationLink href={`/dashboard/automations/scheduled/libraries/${item.library_id}/items`} className="text-sm text-(--text-secondary) hover:text-foreground">Voltar ao acervo</AutomationLink>
    <header><h2 className="text-xl font-semibold text-foreground">Mensagem {item.source_message_id}</h2><p className="mt-2 text-sm text-(--text-secondary)">O original não é alterado. Você está editando a versão preparada para publicar.</p></header>
    {albumLeader&&<p className="text-sm text-(--text-secondary)">Esta mídia faz parte de um álbum. <AutomationLink className="underline" href={`/dashboard/automations/scheduled/libraries/${item.library_id}/items/${albumLeader}`}>Abrir postagem completa do álbum</AutomationLink></p>}
    {item.last_error&&!albumLeader&&<p role="alert" className="break-words text-sm text-(--red)">{item.last_error}</p>}
    <details className="border-b border-(--border-default) pb-5">
      <summary className="cursor-pointer font-medium text-foreground">Consultar original e arquivos</summary>
      <p className="my-4 whitespace-pre-wrap break-words text-sm text-(--text-secondary)">{item.original.content_text||item.original.poll?.question||"Sem texto na origem."}</p>
      <ul className="space-y-3">{(content.media??[]).map((media,i)=><li key={i}><a className="text-sm underline text-foreground" href={media.url} target="_blank" rel="noopener noreferrer">Abrir {media.file_name||`arquivo ${i+1}`}</a></li>)}</ul>
    </details>
    <form onSubmit={e=>{e.preventDefault();perform("save");}} className="space-y-6">
      <fieldset disabled={locked} className="space-y-6 disabled:opacity-60">
        <label className="block space-y-2"><span className="input-label">Texto ou legenda para publicar</span><textarea className="input min-h-56" value={text} maxLength={content.poll?300:content.media?.length?1024:4096} onChange={e=>setText(e.target.value)}/></label>
        <section className="space-y-4"><h3 className="font-medium text-foreground">Botões desta postagem</h3>{buttons.map((b,i)=><div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-1"><span className="input-label">Texto</span><input className="input" required maxLength={64} value={b.text} onChange={e=>setButtons(buttons.map((v,j)=>i===j?{...v,text:e.target.value}:v))}/></label>
          <label className="space-y-1"><span className="input-label">Link</span><input className="input" required type="url" value={b.url} onChange={e=>setButtons(buttons.map((v,j)=>i===j?{...v,url:e.target.value}:v))}/></label>
          <button type="button" className="btn-ghost" onClick={()=>setButtons(buttons.filter((_,j)=>i!==j))}>Remover</button>
        </div>)}<button type="button" className="btn-ghost" disabled={buttons.length>=20} onClick={()=>setButtons([...buttons,{text:"",url:""}])}>Adicionar botão</button></section>
        <label className="block space-y-2"><span className="input-label">Agendar para (horário deste navegador)</span><input className="input" type="datetime-local" value={scheduled} onChange={e=>setScheduled(e.target.value)}/></label>
        <p className="text-sm text-(--text-secondary)">Sem horário, entra na fila para o próximo envio disponível. A automação precisa estar ativa e a origem não pode estar pausada.</p>
        <div className="flex flex-wrap gap-3"><button className="btn-primary" disabled={!["ready","skipped"].includes(item.status)}>Salvar revisão</button><button type="button" className="btn-ghost" disabled={!["ready","skipped"].includes(item.status)} onClick={()=>perform("queue")}>Salvar e colocar na fila</button><button type="button" className="btn-ghost" onClick={()=>perform("reprocess")}>Reprocessar original</button><button type="button" className="btn-ghost" onClick={()=>perform("discard")}>Retirar da fila</button></div>
      </fieldset>
    </form>
    {item.delivery_status==="sent"&&!albumLeader&&<div className="space-y-3"><p className="text-sm text-(--text-secondary)">Esta postagem já foi enviada. Reutilizar prepara o original novamente com as regras atuais e pode gerar uma nova publicação quando a automação estiver ativa.</p><button className="btn-primary" disabled={pending} onClick={()=>perform("reuse")}>Reutilizar conteúdo</button></div>}
    {partial&&item.delivery_status==="failed"&&<div className="space-y-3"><p className="text-sm text-(--text-secondary)">Parte da postagem já foi confirmada. Continue somente as etapas pendentes, mantendo o conteúdo para não repetir as mídias.</p><button className="btn-primary" disabled={pending} onClick={()=>perform("retry")}>Continuar envio pendente</button></div>}
    {item.delivery_status==="sending"&&<section className="space-y-4 border-t border-(--border-default) pt-6"><h3 className="font-semibold text-foreground">Conferir envio no Telegram</h3><p className="text-sm text-(--text-secondary)">Se o envio ficou sem confirmação, pause esta automação e confira o destino. A conferência fica disponível cinco minutos após o início do envio. Uma nova tentativa pode duplicar a última etapa se ela chegou ao Telegram sem retornar confirmação.</p><label className="flex items-start gap-3 text-sm text-foreground"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>Conferi o canal de destino e sei quais etapas chegaram.</label><div className="flex flex-wrap gap-3"><button className="btn-ghost" disabled={pending||enabled||!ack} onClick={()=>resolve("sent")}>Marcar como concluída</button><button className="btn-ghost" disabled={pending||enabled||!ack} onClick={()=>resolve("retry")}>Liberar etapas sem confirmação</button></div></section>}
    {!!receipts.length&&<p className="text-xs text-(--text-secondary)">Mensagens confirmadas no destino: {receipts.flatMap(r=>r.messageIds).join(", ")}</p>}
    {feedback&&<p role="status" className="text-sm text-(--text-secondary)">{feedback}</p>}
  </div>;
}
