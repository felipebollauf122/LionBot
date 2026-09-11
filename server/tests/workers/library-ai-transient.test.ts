import {beforeEach,describe,it,expect,vi} from "vitest";
import {GeminiError} from "../../src/services/ai/gemini.js";
import type {Library,Item} from "../../src/services/automation-library/types.js";

/**
 * Sobrecarga do Gemini (503 UNAVAILABLE) é temporária por definição. Marcar o
 * item como `failed` joga fora um tratamento que só precisava esperar, e exige
 * que o usuário pause a automação e reprocesse na mão.
 */
const h=vi.hoisted(()=>({repo:{} as Record<string,unknown>,generate:vi.fn(),item:{} as Item}));
vi.mock("../../src/config.js",()=>({config:{telegramApiId:1,telegramApiHash:"t",mtprotoWorkerEnabled:false,geminiApiKey:"k",geminiModel:"m"}}));
vi.mock("../../src/db.js",()=>({supabase:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})}}));
vi.mock("../../src/services/mtproto/client.js",()=>({MtprotoClient:class{raw={addEventHandler:vi.fn()};connect=async()=>{};disconnect=async()=>{};}}));
vi.mock("../../src/services/ai/gemini.js",async(orig)=>({...(await orig() as object),GeminiClient:class{generateJson=h.generate;}}));
vi.mock("../../src/services/automation-library/repository.js",()=>({LibraryRepository:class{constructor(){return h.repo;}},checked:async(q:Promise<{data:unknown}>)=>(await q).data}));
vi.mock("../../src/services/automation-library/telegram.js",()=>({archiveGroup:vi.fn(),publishLibraryItem:vi.fn()}));

const library={id:"l",tenant_id:"t",dest_dialog_id:"d",enabled:true,rules:{ai_enabled:true,ai_instructions:"reescreva"}} as unknown as Library;
let processItems: typeof import("../../src/workers/library-worker.js").processItems;

beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();
 h.item={id:"i1",tenant_id:"t",library_id:"l",source_id:"s",source_message_id:5,source_grouped_id:null,
  original:{kind:"text",content_text:"Post original",media:[],entities:[],inline_links:[],poll:null,file_name:null},
  processed:null,status:"pending",delivery_status:"draft",scheduled_at:null,processing_started_at:"2026-01-01T00:00:00Z",
  delivery_claimed_at:null,attempts:0,created_at:"2026-01-01T00:00:00Z",delivery_receipts:[]} as Item;
 h.repo={
  pending:vi.fn(async()=>[h.item]),
  source:vi.fn(async()=>({id:"s",status:"importing"})),
  album:vi.fn(async()=>[h.item]),
  claimProcessing:vi.fn(async()=>h.item),
  finish:vi.fn(async()=>true),
  processingFailed:vi.fn(async()=>{}),
  processingDeferred:vi.fn(async()=>{}),
  skipMember:vi.fn(async()=>{}),
 };
 processItems=(await import("../../src/workers/library-worker.js")).processItems;
});

describe("tratamento com IA sobrecarregada",()=>{
 it("503 do Gemini devolve o item pra fila, sem marcar falha definitiva",async()=>{
  h.generate.mockRejectedValue(new GeminiError("Gemini respondeu 503: sobrecarga",true));
  await processItems(library);
  expect(h.repo.processingFailed).not.toHaveBeenCalled();
  expect(h.repo.processingDeferred).toHaveBeenCalledWith(h.item,expect.stringContaining("503"));
 });

 it("uma vez sobrecarregado, nao insiste no ciclo seguinte",async()=>{
  h.generate.mockRejectedValue(new GeminiError("503",true));
  await processItems(library);
  await processItems(library);
  // Segunda passada nem reivindica: esperar é o certo enquanto a janela dura.
  expect(h.generate).toHaveBeenCalledTimes(1);
 });

 it("erro definitivo continua marcando falha, pra aparecer na revisao",async()=>{
  h.generate.mockRejectedValue(new GeminiError("Gemini respondeu 400: pedido invalido",false));
  await processItems(library);
  expect(h.repo.processingDeferred).not.toHaveBeenCalled();
  expect(h.repo.processingFailed).toHaveBeenCalledWith(h.item,expect.stringContaining("400"));
 });
});
