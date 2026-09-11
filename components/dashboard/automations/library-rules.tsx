"use client";
import { useState,useTransition } from "react";
import { saveLibraryRules } from "@/app/dashboard/automations/scheduled/libraries/actions";
import { defaultLibraryRules,libraryKinds,type LibraryRules } from "@/lib/automations/library-types";
import { ReprocessDrafts } from "./library-controls";

const kindLabels:Record<string,string>={text:"Textos",photo:"Fotos",video:"Vídeos",audio:"Áudios",album:"Álbuns",document:"Arquivos",poll:"Enquetes"};
export function LibraryRulesForm({libraryId,initial,enabled}:{libraryId:string;initial:LibraryRules;enabled:boolean}){
 const [rules,setRules]=useState<LibraryRules>({...defaultLibraryRules,...initial});
 const [pending,start]=useTransition();const [feedback,setFeedback]=useState("");
 function update<K extends keyof LibraryRules>(key:K,value:LibraryRules[K]){setRules(r=>({...r,[key]:value}));}
 return <div className="max-w-3xl">
  <h2 className="text-xl font-semibold text-foreground">Regras de tratamento e publicação</h2>
  <p className="mb-8 mt-2 text-sm text-(--text-secondary)">As regras pertencem a este destino e valem para todas as suas origens. O original fica preservado no acervo.</p>
  {enabled&&<p className="mb-6 text-sm text-(--amber)">Pause a automação acima para editar as regras.</p>}
  <form onSubmit={e=>{e.preventDefault();setFeedback("");start(async()=>{try{const r=await saveLibraryRules(libraryId,rules);setFeedback(r.ok?"Regras salvas. Ative a automação quando estiver pronto.":r.error);}catch{setFeedback("Não foi possível salvar. Tente novamente.");}});}} className="space-y-8">
  <fieldset disabled={enabled||pending} className="space-y-8 disabled:opacity-60">
   <section className="space-y-4">
    <h3 className="font-semibold text-foreground">Gemini</h3>
    <label className="flex items-center gap-3 text-sm text-foreground"><input type="checkbox" checked={rules.ai_enabled} onChange={e=>update("ai_enabled",e.target.checked)}/>Aplicar instruções do Gemini antes de publicar</label>
    <label className="block space-y-2"><span className="input-label">Suas instruções</span><textarea className="input min-h-56" maxLength={20000} value={rules.ai_instructions} onChange={e=>update("ai_instructions",e.target.value)} placeholder={"Ex.: Reescreva as legendas no tom da minha marca. Remova referências à origem. Troque todos os links de convite por https://t.me/meucanal. Inclua um botão “Falar comigo”. Descarte propaganda de concorrentes. Em posts de venda, aguarde 30 minutos antes de enviar."}/></label>
    <p className="text-sm text-(--text-secondary)">Você pode instruir o Gemini sobre texto, legendas, links, botões, descarte e atraso antes do envio. A IA recebe textos e metadados das mídias; não interpreta o conteúdo visual dos arquivos. Erros ficam para revisão e não liberam a publicação do original.</p>
   </section>
   <section className="space-y-4 border-t border-(--border-default) pt-6">
    <h3 className="font-semibold text-foreground">Como publicar</h3>
    <label className="block space-y-2"><span className="input-label">Organização das mídias</span><select className="input" value={rules.media_mode} onChange={e=>update("media_mode",e.target.value as LibraryRules["media_mode"])}><option value="album">Preservar álbuns da origem</option><option value="separate">Enviar cada mídia separadamente</option></select></label>
    <p className="text-sm text-(--text-secondary)">Em álbuns e enquetes, os botões vão em uma mensagem complementar. Em mídias separadas, ficam na última mídia. O Gemini também pode escolher entre álbum e mídias separadas e definir uma data com horário.</p>
    <label className="block space-y-2"><span className="input-label">Modo de publicação</span><select className="input" value={rules.delivery_mode} onChange={e=>update("delivery_mode",e.target.value as LibraryRules["delivery_mode"])}>
     <option value="review">Revisar e agendar manualmente cada postagem</option><option value="immediate">Publicar assim que o tratamento terminar</option><option value="interval">Publicar com intervalo entre as postagens</option>
    </select></label>
    <div className="grid gap-4 sm:grid-cols-2">
     <label className="block space-y-2"><span className="input-label">Intervalo entre postagens (minutos)</span><input className="input" type="number" min="0" max="43200" step="1" disabled={rules.delivery_mode!=="interval"} value={rules.interval_seconds/60} onChange={e=>update("interval_seconds",Math.round(Number(e.target.value)*60))}/></label>
     <label className="block space-y-2"><span className="input-label">Fuso informado ao Gemini</span><input className="input" value={rules.timezone} onChange={e=>update("timezone",e.target.value)} placeholder="America/Sao_Paulo"/></label>
    </div>
    <label className="block space-y-2"><span className="input-label">Não publicar antes de (horário deste navegador)</span><input className="input" type="datetime-local" value={rules.start_at?new Date(Date.parse(rules.start_at)-new Date(rules.start_at).getTimezoneOffset()*60000).toISOString().slice(0,16):""} onChange={e=>update("start_at",e.target.value?new Date(e.target.value).toISOString():null)}/></label>
    <label className="flex items-center gap-3 text-sm text-foreground"><input type="checkbox" checked={rules.silent} onChange={e=>update("silent",e.target.checked)}/>Publicar sem notificação sonora</label>
   </section>
   <section className="space-y-4 border-t border-(--border-default) pt-6">
    <h3 className="font-semibold text-foreground">Texto e links</h3>
    <label className="block space-y-2"><span className="input-label">Texto antes da postagem</span><textarea className="input" rows={2} value={rules.prefix} onChange={e=>update("prefix",e.target.value)}/></label>
    <label className="block space-y-2"><span className="input-label">Assinatura após a postagem</span><textarea className="input" rows={2} value={rules.suffix} onChange={e=>update("suffix",e.target.value)}/></label>
    <p className="text-sm text-(--text-secondary)">Substituições exatas aplicadas antes do Gemini, incluindo nomes, termos e links.</p>
    {rules.replacements.map((row,i)=><div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
     <label className="space-y-1"><span className="input-label">Substituir</span><input className="input" required value={row.from} onChange={e=>update("replacements",rules.replacements.map((r,j)=>j===i?{...r,from:e.target.value}:r))}/></label>
     <label className="space-y-1"><span className="input-label">Por</span><input className="input" value={row.to} onChange={e=>update("replacements",rules.replacements.map((r,j)=>j===i?{...r,to:e.target.value}:r))}/></label>
     <button type="button" className="btn-ghost" onClick={()=>update("replacements",rules.replacements.filter((_,j)=>j!==i))}>Remover</button>
    </div>)}
    <button type="button" className="btn-ghost" onClick={()=>update("replacements",[...rules.replacements,{from:"",to:""}])}>Adicionar substituição</button>
   </section>
   <section className="space-y-4 border-t border-(--border-default) pt-6">
    <h3 className="font-semibold text-foreground">Botões de link</h3>
    <label className="block space-y-2"><span className="input-label">Texto da mensagem de botões após álbuns ou enquetes</span><input className="input" required maxLength={4096} value={rules.button_message} onChange={e=>update("button_message",e.target.value)}/></label>
    <label className="flex items-center gap-3 text-sm text-foreground"><input type="checkbox" checked={rules.preserve_buttons} onChange={e=>update("preserve_buttons",e.target.checked)}/>Preservar botões da origem quando não houver botões personalizados</label>
    {rules.buttons.map((b,i)=><div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
     <label className="space-y-1"><span className="input-label">Texto do botão</span><input className="input" required maxLength={64} value={b.text} onChange={e=>update("buttons",rules.buttons.map((r,j)=>j===i?{...r,text:e.target.value}:r))}/></label>
     <label className="space-y-1"><span className="input-label">Link</span><input className="input" type="url" required value={b.url} onChange={e=>update("buttons",rules.buttons.map((r,j)=>j===i?{...r,url:e.target.value}:r))}/></label>
     <button type="button" className="btn-ghost" onClick={()=>update("buttons",rules.buttons.filter((_,j)=>j!==i))}>Remover</button>
    </div>)}
    <button type="button" className="btn-ghost" onClick={()=>update("buttons",[...rules.buttons,{text:"",url:""}])}>Adicionar botão</button>
   </section>
   <section className="space-y-4 border-t border-(--border-default) pt-6"><h3 className="font-semibold text-foreground">Conteúdo permitido para publicação</h3><div className="flex flex-wrap gap-4">{libraryKinds.map(kind=><label key={kind} className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={rules.allowed_kinds.includes(kind)} onChange={e=>update("allowed_kinds",e.target.checked?[...rules.allowed_kinds,kind]:rules.allowed_kinds.filter(k=>k!==kind))}/>{kindLabels[kind]}</label>)}</div><p className="text-sm text-(--text-secondary)">Os conteúdos filtrados continuam no acervo para consulta.</p></section>
   <button className="btn-primary" disabled={pending||enabled}>{pending?"Salvando…":"Salvar regras"}</button>
  </fieldset>
  {feedback&&<p role="status" className="text-sm text-(--text-secondary)">{feedback}</p>}
  </form>
  <ReprocessDrafts libraryId={libraryId} disabled={enabled}/>
 </div>;
}
