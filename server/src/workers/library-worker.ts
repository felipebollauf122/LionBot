import { Api } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { supabase } from "../db.js";
import { config } from "../config.js";
import { MtprotoClient } from "../services/mtproto/client.js";
import { buildHistoryPeer } from "../services/mtproto/clone/history-iterator.js";
import { extractWaitSeconds } from "../services/mtproto/flood.js";
import { GeminiClient } from "../services/ai/gemini.js";
import { LibraryRepository, checked } from "../services/automation-library/repository.js";
import { parseRules, treat, canSend } from "../services/automation-library/core.js";
import { archiveGroup, publishLibraryItem } from "../services/automation-library/telegram.js";
import type { Library, Source, Item } from "../services/automation-library/types.js";

const repo=new LibraryRepository(supabase);
const connections=new Map<string,{client:MtprotoClient,tenant:string}>();
const connecting=new Map<string,Promise<MtprotoClient>>();
const busy=new Set<string>();
const processing=new Set<string>();
const sourceBusy=new Set<string>();
const wakeTimers=new Map<string,ReturnType<typeof setTimeout>>();
let stopped=false;
let interval:ReturnType<typeof setInterval>|undefined;
let scanning=false;
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);

async function clientFor(accountId:string,tenant:string):Promise<MtprotoClient> {
  const current=connections.get(accountId);
  if(current){if(current.tenant!==tenant)throw new Error("Conta pertence a outro usuário.");return current.client;}
  // Histories and live listeners can request the same account concurrently.
  const key=tenant+":"+accountId;
  const pending=connecting.get(key);if(pending)return pending;
  const opening=openClient(accountId,tenant);connecting.set(key,opening);
  try{return await opening;}finally{connecting.delete(key);}
}
async function openClient(accountId:string,tenant:string):Promise<MtprotoClient> {
  const account=await checked(supabase.from("mtproto_accounts").select("session_string,status").eq("id",accountId).eq("tenant_id",tenant).maybeSingle()) as {session_string:string;status:string}|null;
  if(!account?.session_string||account.status!=="active")throw new Error("Conta Telegram inativa ou sessão expirada.");
  const client=new MtprotoClient(config.telegramApiId,config.telegramApiHash,account.session_string);
  await client.connect();
  client.raw.addEventHandler(async (event:NewMessageEvent)=>{
    // A short trailing buffer lets Telegram finish delivering an album.
    const peer=event.message.peerId;
    if(!(peer instanceof Api.PeerChannel)&&!(peer instanceof Api.PeerChat))return;
    const key=accountId;
    if(wakeTimers.has(key))clearTimeout(wakeTimers.get(key)!);
    wakeTimers.set(key,setTimeout(()=>{wakeTimers.delete(key);void tick();},1200));
  },new NewMessage({}));
  connections.set(accountId,{client,tenant});
  return client;
}

export async function ingestLibrarySource(library:Library,initial:Source,watchLane=false):Promise<void> {
  const busyKey=initial.id+(watchLane?":watch":":history");
  if(sourceBusy.has(busyKey)||stopped||["paused","failed","completed"].includes(initial.status))return;
  if(watchLane&&(!initial.watch||initial.watch_cursor_message_id===null))return;
  // `Number(...)` no limite: 0 significa "nunca estabelecido" (um defeito
  // antigo gravava 0 e a origem se aposentava sozinha com zero itens).
  if(!watchLane&&Number(initial.history_until_message_id)>0&&(!initial.import_history||Number(initial.cursor_message_id)>=Number(initial.history_until_message_id)))return;
  sourceBusy.add(busyKey);
  let source:Source|null=null;
  try{
    source=await repo.lease(initial,watchLane);
    if(!source)return;
    const dialog=await repo.dialog(source.source_dialog_id,source.tenant_id);
    const destination=await repo.dialog(library.dest_dialog_id,library.tenant_id);
    if(dialog.peer_id===destination.peer_id&&dialog.peer_type===destination.peer_type)throw new Error("Origem e destino são iguais.");
    const client=await clientFor(dialog.account_id,source.tenant_id);
    const peer=buildHistoryPeer({peerId:dialog.peer_id,peerType:dialog.peer_type as "channel"|"chat",accessHash:dialog.peer_access_hash});
    // `iterMessages` e nao `getMessages`: e a MESMA chamada que o clonador usa
    // pra ler historico nesta conta, e a unica com leitura comprovada. Um
    // `getMessages(peer,{limit:1})` voltando vazio congelava o limite em 0,
    // e dai `maxId:1` nao deixava nenhuma mensagem passar — a origem terminava
    // "histórico importado" com zero itens e sem erro.
    // O limite maior pula mensagens de servico (entrou no canal, trocou foto)
    // que possam estar no topo: o que interessa e a mensagem de CONTEUDO mais
    // nova. Boundary 0 nao existe: id de mensagem comeca em 1.
    if(!watchLane&&!Number(source.history_until_message_id)){
      let latest:Api.Message|null=null;
      for await(const raw of client.raw.iterMessages(peer,{limit:50})){
        if(raw instanceof Api.Message){latest=raw;break;}
      }
      if(!latest)throw new Error("Nenhuma mensagem legível nesta origem. Abra o canal ou grupo no Telegram com a conta conectada e confirme que o conteúdo aparece; depois use Retomar origem.");
      if(latest.groupedId&&latest.date*1000>Date.now()-2500)return;
      const boundary=latest.id;
      source=await repo.sourcePatch(source,{history_until_message_id:boundary,watch_cursor_message_id:boundary,status:source.import_history?"importing":"watching",last_error:null});
      if(!source.import_history)return;
    }
    if(!watchLane)source=await repo.sourcePatch(source,{status:source.import_history?"importing":"watching"});
    else if(!source.import_history||Number(source.cursor_message_id)>=Number(source.history_until_message_id))source=await repo.sourcePatch(source,{status:"watching"});
    let group:Api.Message[]=[];
    let handled=0;
    let exhausted=true;
    const flush=async()=>{
      if(!group.length||!source)return;
      const [fresh,liveSource]=await Promise.all([repo.library(library.id,library.tenant_id),repo.source(source.id,source.tenant_id)]);
      if(stopped||!fresh?.enabled||liveSource?.status==="paused")throw new Error("Automação pausada.");
      const leaseField=watchLane?"watch_lease_until":"lease_until";
      if(Date.parse(source[leaseField]!)<Date.now()+120_000)source=await repo.sourcePatch(source,{[leaseField]:new Date(Date.now()+300_000).toISOString()});
      const unit=await archiveGroup(client,repo,source,group);
      await repo.insertUnit(source,unit);
      source=await repo.sourcePatch(source,{[watchLane?"watch_cursor_message_id":"cursor_message_id"]:unit.cursor,imported_count:await repo.count(source),last_error:null});
      handled+=group.length;group=[];
    };
    for await(const raw of client.raw.iterMessages(peer,{reverse:true,offsetId:Number(watchLane?source.watch_cursor_message_id:source.cursor_message_id),maxId:watchLane?undefined:Number(source.history_until_message_id)+1,limit:undefined})){
      if(!(raw instanceof Api.Message))continue;
      if(group.length&&(raw.groupedId?.toString()!==group[0].groupedId?.toString()||!raw.groupedId||group.length===10))await flush();
      if(handled>=100){exhausted=false;break;}
      group.push(raw);
      if(!raw.groupedId)await flush();
      if(handled>0&&handled%50===0)await new Promise(r=>setTimeout(r,500));
    }
    // A fresh trailing album may still be arriving. Leave its cursor untouched.
    if(group[0]?.groupedId && group.some(m=>m.date*1000>Date.now()-2500)) exhausted=false;
    else await flush();
    if(source&&!watchLane)source=await repo.sourcePatch(source,{status:exhausted?(source.watch?"watching":"completed"):"importing",...(exhausted?{cursor_message_id:source.history_until_message_id}:{}),last_error:null});
  }catch(error){
    if(source){
      const wait=extractWaitSeconds(error);
      if(wait!==null){
        await repo.sourcePatch(source,{[watchLane?"watch_lease_until":"lease_until"]:new Date(Date.now()+(wait+5)*1000).toISOString(),last_error:`Telegram solicitou espera de ${wait}s.`}).catch(()=>{});
        source=null; // Keep the lease until Telegram permits the next read.
      }else if(errorText(error)!=="Automação pausada."){
        await repo.sourcePatch(source,{status:"failed",last_error:errorText(error)}).catch(()=>{});
      }
    }
  }finally{
    if(source)await repo.release(source).catch(()=>{});
    sourceBusy.delete(busyKey);
  }
}

/**
 * Sobrecarga do Gemini e cota estourada sao temporarias por definicao. Depois
 * de uma delas, insistir a cada 5s so gasta cota e enche o item de erro: esta
 * janela deixa o acervo esperar a fila do modelo baixar. Em memoria de
 * proposito — e um amortecedor de processo, nao estado do acervo.
 */
const aiCooldown=new Map<string,number>();
const AI_COOLDOWN_MS=60_000;
/**
 * Cota DIARIA estourada nao volta antes da virada do dia no fuso do Google.
 * Um minuto de espera ali sao ~1400 respostas 429 por dia por acervo, todas
 * pelo mesmo balde que ja acabou; quinze minutos ainda pegam a virada logo e
 * cortam a insistencia por um fator de quinze.
 */
const AI_COOLDOWN_DIARIO_MS=900_000;
/** Erro que o chamador nao deve tratar como definitivo (ver GeminiError). */
const isTransient=(error:unknown):boolean=>(error as {transient?:boolean})?.transient===true;
/** Quando o Gemini diz quanto esperar, quem manda e ele — nunca menos que o piso. */
function aiCooldownDe(error:unknown):number{
  const e=error as {retryAfterMs?:number|null;quotaDiaria?:boolean};
  return Math.max(AI_COOLDOWN_MS,e?.retryAfterMs??0,e?.quotaDiaria?AI_COOLDOWN_DIARIO_MS:0);
}

export async function processItems(library:Library):Promise<void>{
  if((aiCooldown.get(library.id)??0)>Date.now())return;
  const rules=parseRules(library.rules);
  const ai=new GeminiClient(config.geminiApiKey,config.geminiModel);
  const pending=await repo.pending(library);
  const visited=new Set<string>();
  for(const row of pending.slice(0,1)){
    if(stopped||visited.has(row.id))continue;
    const source=await repo.source(row.source_id,library.tenant_id);
    if(!source||source.status==="paused")continue;
    const members=await repo.album(row);
    // The oldest message owns the album; other originals remain archived.
    const leader=members[0];if(!leader)continue;
    members.forEach(m=>visited.add(m.id));
    if(leader.id!==row.id&&leader.status!=="pending"){await repo.skipMember(row,leader.id);continue;}
    const claimed=await repo.claimProcessing(leader);if(!claimed)continue;
    try{
      const transformed=await treat(members.map(m=>m.original),members.map(m=>m.id),rules,ai);
      if(await repo.finish(claimed,transformed,library.rules))for(const member of members.slice(1))await repo.skipMember(member,leader.id);
    }catch(error){
      if(isTransient(error)){
        // Volta pra fila com o motivo a vista. O original fica intacto e o
        // tratamento e refeito quando o modelo voltar — nada se perde.
        aiCooldown.set(library.id,Date.now()+aiCooldownDe(error));
        await repo.processingDeferred(claimed,errorText(error));
      }else{
        await repo.processingFailed(claimed,errorText(error));
      }
    }
  }
}
function floodSeconds(error:unknown):number|null{
  const telegram=(error as {parameters?:{retry_after?:number}})?.parameters?.retry_after;
  return typeof telegram==="number"?telegram:extractWaitSeconds(error);
}
async function deliver(library:Library):Promise<void>{
  const item=await repo.claimDue(library);if(!item)return;
  let calledTelegram=false;
  try{
    const current=await repo.library(library.id,library.tenant_id);
    const source=await repo.source(item.source_id,item.tenant_id);
    if(!current||!source||!canSend(current,source,item)){
      await repo.deliveryPatch(item,{delivery_status:"pending",delivery_claimed_at:null});return;
    }
    const dest=await repo.dialog(current.dest_dialog_id,current.tenant_id);
    const rules=parseRules(current.rules);
    const messageId=await publishLibraryItem(repo,current,dest,item.processed!,rules.silent,{
      receipts:item.delivery_receipts??[],
      beforeSend:async()=>{
        const live=await repo.library(current.id,current.tenant_id);
        const liveSource=await repo.source(source.id,source.tenant_id);
        if(stopped||!live?.enabled||!liveSource||liveSource.status==="paused")throw new Error("Automação pausada antes do próximo envio.");
        calledTelegram=true;
      },
      confirmed:async(receipts)=>{
        await repo.deliveryPatch(item,{delivery_receipts:receipts});
        calledTelegram=false;
      },
    });
    await repo.deliveryPatch(item,{delivery_status:"sent",sent_at:new Date().toISOString(),dest_message_id:messageId,last_error:null});
  }catch(error){
    const wait=floodSeconds(error);
    if(wait!==null){await repo.deferFlood(item,wait);return;}
    const knownRejection=typeof (error as {error_code?:unknown})?.error_code==="number";
    // A timeout after sending has an uncertain result. Do not auto-replay it.
    if(calledTelegram&&!knownRejection){
      await repo.deliveryPatch(item,{last_error:`Envio sem confirmação: ${errorText(error)}. Confira o destino antes de liberar uma nova tentativa.`});
    }else{
      await repo.deliveryPatch(item,{delivery_status:"failed",last_error:errorText(error)});
    }
  }
}
async function runLibrary(library:Library){
  if(busy.has(library.id)||stopped)return;
  busy.add(library.id);
  try{
    const sources=await repo.sources(library);
    // Import runs independently so a large history cannot delay ready posts.
    for(const source of sources){void ingestLibrarySource(library,source);void ingestLibrarySource(library,source,true);}
    // Run one transformation at a time without delaying delivery or event-driven collection.
    if(!processing.has(library.id)){
      processing.add(library.id);
      void processItems(library).catch(error=>repo.libraryError(library,errorText(error))).catch(()=>{}).finally(()=>processing.delete(library.id));
    }
    if((await repo.library(library.id,library.tenant_id))?.enabled)await deliver(library);
  }catch(error){await repo.libraryError(library,errorText(error)).catch(()=>{});}
  finally{busy.delete(library.id);}
}
async function tick(){
  if(stopped||scanning)return;scanning=true;
  try{for(const library of await repo.libraries())void runLibrary(library);}
  catch(error){console.warn("[library-worker]",errorText(error));}
  finally{scanning=false;}
}
/** Diagnóstico de deploy: `/health` responde se ESTE processo tem o coletor. */
export function isLibraryWorkerRunning():boolean{return interval!==undefined;}
export function startLibraryWorker():void{
  if(interval||!config.mtprotoWorkerEnabled||!config.telegramApiId||!config.telegramApiHash)return;
  stopped=false;interval=setInterval(()=>void tick(),5000);interval.unref();void tick();
}
export async function stopLibraryWorker():Promise<void>{
  stopped=true;if(interval)clearInterval(interval);interval=undefined;
  for(const timer of wakeTimers.values())clearTimeout(timer);wakeTimers.clear();
  await Promise.allSettled([...connections.values()].map(c=>c.client.disconnect()));
  connections.clear();
}
