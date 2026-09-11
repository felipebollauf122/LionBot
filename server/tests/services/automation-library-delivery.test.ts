import {describe,it,expect,vi} from "vitest";
import type {Bot} from "grammy";
import {sendLibraryContent,type DeliveryProgress} from "../../src/services/automation-library/telegram.js";
import type {Processed} from "../../src/services/automation-library/types.js";
const content=(patch:Partial<Processed>={}):Processed=>({kind:"album",content_text:"Legenda",media:[{kind:"photo",url:"https://files.test/1",file_name:"1.jpg"},{kind:"video",url:"https://files.test/2",file_name:"2.mp4"}],entities:[],inline_links:[],buttons:[{text:"Abrir",url:"https://example.com"}],button_message:"Saiba mais",media_mode:"album",delaySeconds:0,discard:false,member_ids:["1","2"],poll:null,file_name:null,...patch});
function setup(){
  const api={sendMediaGroup:vi.fn(async()=>[{message_id:10},{message_id:11}]),sendMessage:vi.fn(async()=>({message_id:12})),sendPhoto:vi.fn(async()=>({message_id:10})),sendVideo:vi.fn(async()=>({message_id:11}))};
  const progress:DeliveryProgress={receipts:[],beforeSend:vi.fn(async()=>{}),confirmed:vi.fn(async(rows)=>{progress.receipts=rows;})};
  return {api,progress,send:(c=content())=>sendLibraryContent(api as unknown as Bot["api"],"-100123",c,true,progress)};
}
describe("library publisher step receipts",()=>{
  it("publishes album then a configurable button message and persists both",async()=>{
    const h=setup();expect(await h.send()).toBe(10);
    expect(h.api.sendMediaGroup).toHaveBeenCalledOnce();
    expect(h.api.sendMessage).toHaveBeenCalledWith("-100123","Saiba mais",expect.objectContaining({reply_markup:{inline_keyboard:[[{text:"Abrir",url:"https://example.com"}]]}}));
    expect(h.progress.receipts.map(r=>r.step)).toEqual(["album","buttons"]);
  });
  it("resumes after a button rejection without repeating the confirmed album",async()=>{
    const h=setup();h.api.sendMessage.mockRejectedValueOnce({error_code:429,parameters:{retry_after:30}});
    await expect(h.send()).rejects.toMatchObject({error_code:429});
    expect(h.progress.receipts).toEqual([{step:"album",messageIds:[10,11]}]);
    await h.send();
    expect(h.api.sendMediaGroup).toHaveBeenCalledOnce();
    expect(h.api.sendMessage).toHaveBeenCalledTimes(2);
  });
  it("puts the caption on first and keyboard on last when sending separately",async()=>{
    const h=setup();await h.send(content({media_mode:"separate"}));
    expect(h.api.sendPhoto).toHaveBeenCalledWith("-100123",expect.objectContaining({filename:"1.jpg"}),expect.objectContaining({caption:"Legenda",reply_markup:undefined}));
    expect(h.api.sendVideo).toHaveBeenCalledWith("-100123",expect.objectContaining({filename:"2.mp4"}),expect.objectContaining({caption:undefined,reply_markup:expect.any(Object)}));
    expect(h.api.sendMediaGroup).not.toHaveBeenCalled();
    expect(h.api.sendMessage).not.toHaveBeenCalled();
  });
  it("validates incompatible albums before contacting Telegram",async()=>{
    const h=setup();const c=content();c.media[1].kind="audio";
    await expect(h.send(c)).rejects.toThrow("incompatíveis");
    expect(h.progress.beforeSend).not.toHaveBeenCalled();
  });
  it("stops before sending another step if persistence fails",async()=>{
    const h=setup();h.progress.confirmed=vi.fn(async()=>{throw new Error("db offline");});
    await expect(h.send()).rejects.toThrow("db offline");
    expect(h.api.sendMessage).not.toHaveBeenCalled();
  });
  it("does not send when paused immediately before a request",async()=>{
    const h=setup();h.progress.beforeSend=vi.fn(async()=>{throw new Error("paused");});
    await expect(h.send()).rejects.toThrow("paused");
    expect(h.api.sendMediaGroup).not.toHaveBeenCalled();
  });
});
