import {beforeEach,describe,it,expect,vi} from "vitest";
import {Api} from "telegram";
import type {Library,Source} from "../../src/services/automation-library/types.js";
const h=vi.hoisted(()=>({repo:{} as Record<string,unknown>,raw:{getMessages:vi.fn(),iterMessages:vi.fn(),addEventHandler:vi.fn()},archive:vi.fn(),patches:[] as Record<string,unknown>[],source:{} as Source,enabled:true}));
vi.mock("../../src/config.js",()=>({config:{telegramApiId:1,telegramApiHash:"test",mtprotoWorkerEnabled:false}}));
vi.mock("../../src/db.js",()=>({supabase:{from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{session_string:"test",status:"active"},error:null})};return q;}}}));
vi.mock("../../src/services/mtproto/client.js",()=>({MtprotoClient:class{raw=h.raw;connect=async()=>{};disconnect=async()=>{};}}));
vi.mock("../../src/services/automation-library/repository.js",()=>({LibraryRepository:class{constructor(){return h.repo;}},checked:async(q:Promise<{data:unknown}>)=>(await q).data}));
vi.mock("../../src/services/automation-library/telegram.js",()=>({archiveGroup:h.archive,publishLibraryItem:vi.fn()}));
const library={id:"l",tenant_id:"t",dest_dialog_id:"dest",enabled:true,rules:{}} as Library;
const msg=(id:number,patch:Record<string,unknown>={})=>new Api.Message({id,message:"Post "+id,date:1,peerId:new Api.PeerChannel({channelId:11 as never}),...patch});
let ingest: typeof import("../../src/workers/library-worker.js").ingestLibrarySource;
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();h.patches=[];h.enabled=true;
 h.source={id:"s",tenant_id:"t",library_id:"l",source_dialog_id:"src",status:"pending",import_history:true,watch:true,cursor_message_id:0,imported_count:0,lease_until:null,history_until_message_id:null,watch_cursor_message_id:null,watch_lease_until:null};
 h.repo={
  lease:vi.fn(async(_s:Source,watch_lane:boolean)=>({...h.source,watch_lane,lease_until:new Date(Date.now()+300000).toISOString(),watch_lease_until:new Date(Date.now()+300000).toISOString()})),
  dialog:vi.fn(async(id:string)=>({id,account_id:"a",peer_type:"chat",peer_id:id==="dest"?"22":"11",peer_access_hash:null})),
  sourcePatch:vi.fn(async(s:Source,patch:Record<string,unknown>)=>{h.patches.push(patch);Object.assign(h.source,patch);return {...s,...patch};}),
  source:vi.fn(async()=>h.source),library:vi.fn(async()=>({...library,enabled:h.enabled})),
  insertUnit:vi.fn(async()=>{}),count:vi.fn(async()=>2),release:vi.fn(async()=>{}),
 };
 h.raw.getMessages.mockResolvedValue([msg(100)]);
 h.raw.iterMessages.mockImplementation(async function*(){yield msg(1);yield msg(2);});
 h.archive.mockImplementation(async(_client:unknown,_repo:unknown,_source:Source,raws:Api.Message[])=>({messages:[],cursor:Math.max(...raws.map(m=>m.id))}));
 ingest=(await import("../../src/workers/library-worker.js")).ingestLibrarySource;
});
describe("history and live collection lanes",()=>{
 it("freezes a history boundary and initializes an independent live cursor",async()=>{
  await ingest(library,{...h.source});
  expect(h.source.history_until_message_id).toBe(100);
  expect(h.source.watch_cursor_message_id).toBe(100);
  expect(h.raw.iterMessages).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({offsetId:0,maxId:101}));
  expect(h.source.cursor_message_id).toBe(100);
 });
 it("watch-only activation starts at the current tail, not at the beginning",async()=>{
  h.source.import_history=false;
  await ingest(library,{...h.source});
  expect(h.source.watch_cursor_message_id).toBe(100);
  expect(h.raw.iterMessages).not.toHaveBeenCalled();
 });
 it("live lane reads its own cursor even while historical import is behind",async()=>{
  Object.assign(h.source,{history_until_message_id:100,watch_cursor_message_id:120,cursor_message_id:4,status:"importing"});
  h.raw.iterMessages.mockImplementation(async function*(){yield msg(121);});
  await ingest(library,{...h.source},true);
  expect(h.raw.iterMessages).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({offsetId:120,maxId:undefined}));
  expect(h.source.watch_cursor_message_id).toBe(121);
  expect(h.source.cursor_message_id).toBe(4);
 });
 it("failed archiving cannot advance either cursor",async()=>{
  Object.assign(h.source,{history_until_message_id:100,watch_cursor_message_id:120,cursor_message_id:4,status:"importing"});
  h.archive.mockRejectedValue(new Error("Storage offline"));
  await ingest(library,{...h.source});
  expect(h.source.cursor_message_id).toBe(4);
  expect(h.source.watch_cursor_message_id).toBe(120);
  expect(h.source.status).toBe("failed");
  expect(h.repo.insertUnit).not.toHaveBeenCalled();
 });
 it("does not turn a user pause into a source failure",async()=>{
  h.enabled=false;
  await ingest(library,{...h.source});
  expect(h.source.status).not.toBe("failed");
  expect(h.repo.insertUnit).not.toHaveBeenCalled();
 });
 it("buffers a newly arriving trailing album without advancing",async()=>{
  Object.assign(h.source,{history_until_message_id:100,watch_cursor_message_id:120,status:"watching"});
  h.raw.iterMessages.mockImplementation(async function*(){yield msg(121,{date:Math.floor(Date.now()/1000),groupedId:42});});
  await ingest(library,{...h.source},true);
  expect(h.source.watch_cursor_message_id).toBe(120);
  expect(h.archive).not.toHaveBeenCalled();
 });
});
