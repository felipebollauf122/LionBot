import {describe,it,expect,vi} from "vitest";
import {parseRules,treat,validateAi,canSend,destinationChatId,validateArchivedMediaUrl} from "../../src/services/automation-library/core.js";
import type {Original,Library,Source,Item} from "../../src/services/automation-library/types.js";
const original=(patch:Partial<Original>={}):Original=>({kind:"text",content_text:"Confira https://old.test",media:[],entities:[],inline_links:[{text:"Abrir",url:"https://old.test"}],poll:null,file_name:null,...patch});
const ai={generateJson:vi.fn()};
describe("permanent library treatment",()=>{
  it("preserves original and replaces text, button URLs and hidden links",async()=>{
    const input=original({entities:[{type:"text_link",offset:0,length:7,url:"https://old.test"}]});
    const snapshot=structuredClone(input);
    const result=await treat([input],["one"],parseRules({replacements:[{from:"old.test",to:"new.test"}]}),ai);
    expect(result.content_text).toBe("Confira https://new.test");
    expect(result.buttons[0].url).toBe("https://new.test");
    expect(input).toEqual(snapshot);
    const hidden=await treat([original({content_text:"Confira",entities:input.entities})],["one"],parseRules({replacements:[{from:"old.test",to:"new.test"}]}),ai);
    expect(hidden.entities[0]).toMatchObject({url:"https://new.test"});
  });
  it("treats a whole album once, and filters by album rather than member kind",async()=>{
    const result=await treat([original({kind:"photo",media:[{kind:"photo",url:"https://file.test/1",file_name:"1.jpg"}]}),original({kind:"photo",content_text:"",media:[{kind:"photo",url:"https://file.test/2",file_name:"2.jpg"}]})],["1","2"],parseRules({allowed_kinds:["album"]}),ai);
    expect(result).toMatchObject({kind:"album",discard:false,member_ids:["1","2"]});
    expect(result.media).toHaveLength(2);
  });
  it("honors structured AI text, buttons, scheduling and sending format",async()=>{
    const generateJson=vi.fn(async()=>({text:"Novo texto",buttons:[{text:"Meu canal",url:"https://t.me/meu"}],scheduledAt:"2027-01-01T10:00:00-03:00",media_mode:"separate",delaySeconds:60}));
    const result=await treat([original()],["1"],parseRules({ai_enabled:true,ai_instructions:"Minha regra"}),{generateJson} as never);
    expect(result).toMatchObject({content_text:"Novo texto",media_mode:"separate",delaySeconds:60,scheduledAt:"2027-01-01T10:00:00-03:00"});
    expect(generateJson.mock.calls).toHaveLength(1);
  });
  it("does not fall back to publishing the original after Gemini failure",async()=>{
    await expect(treat([original()],["1"],parseRules({ai_enabled:true}),{generateJson:async()=>{throw new Error("quota");}})).rejects.toThrow("quota");
  });
  it("retains filtered originals without spending an AI request",async()=>{
    const generateJson=vi.fn();
    const result=await treat([original()],["1"],parseRules({ai_enabled:true,allowed_kinds:["photo"]}),{generateJson});
    expect(result.discard).toBe(true);expect(generateJson).not.toHaveBeenCalled();
  });
  it.each([{destination:"evil"},{buttons:[{text:"x",url:"javascript:alert(1)"}]},{delaySeconds:-1},{scheduledAt:"2027-01-01T10:00"},{media_mode:"anything"}])("rejects invalid AI output %j",value=>expect(()=>validateAi(value)).toThrow());
  it("rejects overlong media captions without truncating original",async()=>{
    await expect(treat([original({kind:"photo",content_text:"x".repeat(1025),media:[{kind:"photo",url:"https://file.test/1",file_name:"a.jpg"}]})],["1"],parseRules({}),ai)).rejects.toThrow("limite");
  });
  it("requires matching owner, source, ready state, due time and active automation",()=>{
    const l={id:"l",tenant_id:"t",enabled:true} as Library;
    const s={id:"s",library_id:"l",tenant_id:"t",status:"watching"} as Source;
    const i={id:"i",source_id:"s",library_id:"l",tenant_id:"t",status:"ready",delivery_status:"sending",scheduled_at:"2020-01-01Z",processed:{discard:false}} as Item;
    expect(canSend(l,s,i)).toBe(true);
    expect(canSend({...l,enabled:false},s,i)).toBe(false);
    expect(canSend(l,{...s,status:"paused"},i)).toBe(false);
    expect(canSend(l,{...s,status:"failed",source_dialog_id:null as never},i)).toBe(true);
    expect(canSend(l,s,{...i,tenant_id:"other"})).toBe(false);
    expect(canSend(l,s,{...i,scheduled_at:"2099-01-01Z"})).toBe(false);
  });
  it("supports basic groups and supergroups/channels without unsafe numeric conversion",()=>{
    expect(destinationChatId("chat","123")).toBe("-123");
    expect(destinationChatId("channel","123")).toBe("-100123");
    expect(()=>destinationChatId("user","123")).toThrow();
  });
  it("only downloads archived media in this tenant's Storage namespace",()=>{
    expect(()=>validateArchivedMediaUrl("https://db.test/storage/v1/object/public/media/t/library/s/file.jpg","https://db.test","t")).not.toThrow();
    for(const url of ["http://127.0.0.1/admin","https://db.test/storage/v1/object/public/media/other/library/s/file.jpg","https://db.test/storage/v1/object/public/media/t/library/%2e%2e%2fsecrets"])expect(()=>validateArchivedMediaUrl(url,"https://db.test","t")).toThrow();
  });
});
