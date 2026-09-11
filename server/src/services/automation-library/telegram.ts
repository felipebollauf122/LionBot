import { Api } from "telegram";
import { Bot, InputFile } from "grammy";
import { config } from "../../config.js";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { SourceReader } from "../mtproto/clone/source-reader.js";
import { planForMessage } from "../mtproto/clone/media-plan.js";
import { toBotApiEntities } from "../mtproto/clone/entities.js";
import { downloadAndRehostMedia } from "../mtproto/bot-clone/media-rehost.js";
import type { MtprotoClient } from "../mtproto/client.js";
import type { LibraryRepository } from "./repository.js";
import { checked } from "./repository.js";
import { destinationChatId, validateArchivedMediaUrl } from "./core.js";
import type { ArchivedUnit, Dialog, Library, Original, Processed, Source } from "./types.js";

const EXT: Record<string,string> = { photo:"jpg",video:"mp4",animation:"mp4",audio:"mp3",sticker:"webp",document:"bin" };
export async function archiveGroup(client: MtprotoClient, repo: LibraryRepository, source: Source, raws: Api.Message[]): Promise<ArchivedUnit> {
  const temporary = await mkdtemp(path.join(tmpdir(),"lion-library-"));
  try {
    const messages: ArchivedUnit["messages"] = [];
    for (const raw of raws) {
      const plan = planForMessage(SourceReader.mediaPlanInput(raw,true));
      const original: Original = {
        kind: plan.kind === "media" ? plan.mediaKind : plan.kind === "skip" ? "unsupported" : plan.kind,
        content_text: raw.message || "", media: [], entities: toBotApiEntities(raw.entities),
        inline_links: (SourceReader.extractInlineLinks(raw) ?? []).map(b=>({text:b.label,url:b.url})),
        poll: SourceReader.pollData(raw), file_name: SourceReader.originalFileName(raw),
      };
      if (plan.kind === "media") {
        const fileName = (original.file_name || `arquivo.${EXT[plan.mediaKind]}`).replace(/[^a-zA-Z0-9._-]/g,"_");
        const url = await downloadAndRehostMedia({raw:client.raw,supabase:repo.db}, {
          media:raw.media,tenantId:source.tenant_id,jobId:source.id,nodeIdHint:`msg_${raw.id}`,
          fileName,tmpDir:temporary,maxBytes:50*1024*1024,keyPrefix:"library",
        });
        if (!url) throw new Error(`Mídia ${raw.id} excede o limite de 50 MB por arquivo; o cursor foi preservado.`);
        original.media.push({kind:plan.mediaKind,url,file_name:fileName});
        if (plan.mediaKind === "animation") original.kind="video";
        if (plan.mediaKind === "sticker") original.kind="document";
      }
      messages.push({id:raw.id,groupedId:raw.groupedId?.toString() ?? null,original});
    }
    return {messages,cursor:Math.max(...raws.map(r=>r.id))};
  } finally {
    // Only this validated mkdtemp directory is removed; library Storage is permanent.
    await rm(temporary,{recursive:true,force:true});
  }
}
export interface DeliveryProgress {
  receipts: Array<{step: string; messageIds: number[]}>;
  beforeSend(): Promise<void>;
  confirmed(receipts: Array<{step: string; messageIds: number[]}>): Promise<void>;
}
export async function publishLibraryItem(repo: LibraryRepository, library: Library, dialog: Dialog, content: Processed, silent: boolean, progress: DeliveryProgress): Promise<number> {
  const companion = await checked(repo.db.from("automation_bots").select("token").eq("tenant_id",library.tenant_id).maybeSingle()) as {token:string} | null;
  if (!companion?.token) throw new Error("Configure o bot de publicação para este destino.");
  for (const media of content.media) validateArchivedMediaUrl(media.url,config.supabaseUrl,library.tenant_id);
  const bot = new Bot(companion.token,{client:{timeoutSeconds:60}});
  return sendLibraryContent(bot.api, destinationChatId(dialog.peer_type,dialog.peer_id),content,silent,progress);
}

/** Persist every successful step before starting the next; resumes never replay confirmed media. */
export async function sendLibraryContent(api: Bot["api"], chat: string, content: Processed, silent: boolean, progress: DeliveryProgress): Promise<number> {
  let receipts = [...progress.receipts];
  const step = async (key: string, send: () => Promise<number[]>) => {
    const existing = receipts.find(r=>r.step===key);
    if (existing) return existing.messageIds;
    await progress.beforeSend();
    const messageIds = await send();
    receipts = [...receipts,{step:key,messageIds}];
    await progress.confirmed(receipts);
    return messageIds;
  };
  const keyboard = content.buttons.length ? {inline_keyboard:content.buttons.map(b=>[{text:b.text,url:b.url}])} : undefined;
  const opts = {disable_notification:silent};
  const caption = content.content_text || undefined;
  const media = content.media;
  // Validate the full plan before any irreversible request.
  if (media.length > 1 && content.media_mode !== "separate") {
    const kinds = new Set(media.map(m=>m.kind));
    if (![...kinds].every(k=>k==="photo"||k==="video") && !(kinds.size===1 && (kinds.has("audio")||kinds.has("document")))) {
      throw new Error("Álbum mistura tipos incompatíveis. Escolha enviar mídias separadamente.");
    }
  }
  let firstId: number;
  if (media.length > 1 && content.media_mode !== "separate") {
    const payload = media.map((m,i)=>({
      type:m.kind as "photo"|"video"|"audio"|"document",media:new InputFile(new URL(m.url),m.file_name),
      caption:i===0?caption:undefined,caption_entities:i===0?(content.entities??undefined):undefined,
    })) as Parameters<Bot["api"]["sendMediaGroup"]>[1];
    firstId=(await step("album",async()=>(await api.sendMediaGroup(chat,payload,opts)).map(m=>m.message_id)))[0];
  } else if (media.length) {
    firstId=0;
    for (let i=0;i<media.length;i++) {
      const m=media[i], common={...opts,caption:i===0?caption:undefined,caption_entities:i===0?(content.entities??undefined):undefined,reply_markup:i===media.length-1?keyboard:undefined};
      const ids=await step(`media:${i}`,async()=>{
        const file=new InputFile(new URL(m.url),m.file_name);
        const sent=m.kind==="photo"?await api.sendPhoto(chat,file,common)
          :m.kind==="video"?await api.sendVideo(chat,file,common)
          :m.kind==="audio"?await api.sendAudio(chat,file,common)
          :m.kind==="voice"?await api.sendVoice(chat,file,common)
          :m.kind==="animation"?await api.sendAnimation(chat,file,common)
          :await api.sendDocument(chat,file,common);
        return [sent.message_id];
      });
      firstId ||= ids[0];
    }
    return firstId;
  } else if (content.poll) {
    const p=content.poll;
    firstId=(await step("poll",async()=>[(await api.sendPoll(chat,p.question,p.options.map(text=>({text})),{...opts,is_anonymous:p.isAnonymous,allows_multiple_answers:p.allowsMultipleAnswers})).message_id]))[0];
  } else {
    return (await step("text",async()=>[(await api.sendMessage(chat,content.content_text,{...opts,reply_markup:keyboard,entities:content.entities??undefined})).message_id]))[0];
  }
  // Telegram sendMediaGroup has no reply_markup: use a separate, configurable message.
  if (keyboard) await step("buttons",async()=>[(await api.sendMessage(chat,content.button_message||"Acesse os links",{...opts,reply_markup:keyboard})).message_id]);
  return firstId;
}
