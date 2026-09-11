import {beforeEach,describe,it,expect,vi} from "vitest";
import {updateLibraryItem,resolveLibraryDelivery,addLibrarySource} from "@/app/dashboard/automations/scheduled/libraries/actions";
const h=vi.hoisted(()=>({access:vi.fn(),library:{id:"l",tenant_id:"t",dest_dialog_id:"dest",enabled:false} as Record<string,unknown>|null,item:{} as Record<string,unknown>,writes:[] as Array<{table:string;patch:Record<string,unknown>}>,filters:[] as unknown[][]}));
vi.mock("@/lib/actions/automations-access-actions",()=>({requireAutomationsAccess:h.access}));
vi.mock("@/lib/actions/admin-actions",()=>({resolveActingTenantId:vi.fn(async()=>"t")}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({from:(table:string)=>{
 let patch:Record<string,unknown>|undefined;
 const resolve=()=>({data:patch?[{id:"i"}]:table==="automation_libraries"?h.library:table==="automation_library_items"?h.item:null,error:null});
 const q={select:()=>q,update:(p:Record<string,unknown>)=>{patch=p;h.writes.push({table,patch:p});return q;},eq:(...v:unknown[])=>{h.filters.push(v);return q;},in:()=>q,maybeSingle:async()=>resolve(),then:(f:(v:unknown)=>unknown)=>Promise.resolve(resolve()).then(f)};
 return q;
}})}));
beforeEach(()=>{
 vi.clearAllMocks();h.writes=[];h.filters=[];h.library={id:"l",tenant_id:"t",dest_dialog_id:"dest",enabled:false};
 h.item={id:"i",status:"ready",delivery_status:"draft",delivery_receipts:[],last_error:null,original:{kind:"text",content_text:"Original",media:[]},processed:{kind:"text",content_text:"Tratado",media:[],buttons:[]}};
});
describe("library server action boundaries",()=>{
 it("cannot mutate a library the caller cannot read",async()=>{
  h.library=null;
  expect((await updateLibraryItem("l","i",{action:"queue"})).ok).toBe(false);
  expect(h.writes).toHaveLength(0);
 });
 it("saves an edit as a draft and preserves original",async()=>{
  h.item.delivery_status="pending";
  expect((await updateLibraryItem("l","i",{action:"save",text:"Revisado"})).ok).toBe(true);
  expect(h.writes[0].patch).toMatchObject({delivery_status:"draft",scheduled_at:null,processed:{content_text:"Revisado"}});
  expect(h.writes[0].patch).not.toHaveProperty("original");
  expect(h.filters).toContainEqual(["delivery_status","pending"]);
 });
 it("does not edit media already partially delivered",async()=>{
  h.item.delivery_status="failed";h.item.delivery_receipts=[{step:"album",messageIds:[1,2]}];
  expect((await updateLibraryItem("l","i",{action:"save",text:"Outro"})).ok).toBe(false);
  expect(h.writes).toHaveLength(0);
 });
 it("retries confirmed partial deliveries without resetting receipts",async()=>{
  h.item.delivery_status="failed";h.item.delivery_receipts=[{step:"album",messageIds:[1,2]}];
  expect((await updateLibraryItem("l","i",{action:"retry"})).ok).toBe(true);
  expect(h.writes[0].patch).not.toHaveProperty("delivery_receipts");
 });
 it("refuses to unlock a recent ambiguous send",async()=>{
  h.item.delivery_status="sending";h.item.delivery_claimed_at=new Date().toISOString();
  expect((await resolveLibraryDelivery("l","i","retry")).ok).toBe(false);
  expect(h.writes).toHaveLength(0);
 });
 it("requires a paused library before manual reconciliation",async()=>{
  h.library!.enabled=true;h.item.delivery_status="sending";h.item.delivery_claimed_at="2020-01-01Z";
  expect((await resolveLibraryDelivery("l","i","sent")).ok).toBe(false);
 });
 it("releases only unconfirmed steps after an explicit reconciliation",async()=>{
  h.item.delivery_status="sending";h.item.delivery_claimed_at="2020-01-01Z";
  expect((await resolveLibraryDelivery("l","i","retry")).ok).toBe(true);
  expect(h.writes[0].patch).toMatchObject({delivery_status:"pending",delivery_claimed_at:null});
  expect(h.writes[0].patch).not.toHaveProperty("delivery_receipts");
 });
 it("rejects an origin that is not accessible through the tenant account",async()=>{
  expect((await addLibrarySource("l",{dialogId:"foreign",importHistory:true,watch:false})).ok).toBe(false);
  expect(h.filters).toContainEqual(["mtproto_accounts.tenant_id","t"]);
  expect(h.writes).toHaveLength(0);
 });
});
