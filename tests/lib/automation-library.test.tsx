import {describe,it,expect,vi} from "vitest";
import {render,screen,fireEvent} from "@testing-library/react";
import {defaultLibraryRules,validateLibraryRules} from "@/lib/automations/library-types";
import {LibraryRulesForm} from "@/components/dashboard/automations/library-rules";
vi.mock("@/app/dashboard/automations/scheduled/libraries/actions",()=>({saveLibraryRules:vi.fn(async()=>({ok:true})),reprocessLibraryDrafts:vi.fn(async()=>({ok:true}))}));
describe("library rule validation and focused form",()=>{
  it("starts paused/review with valid rules",()=>expect(validateLibraryRules(defaultLibraryRules)).toBeNull());
  it.each([{buttons:[{text:"Abrir",url:"javascript:alert(1)"}]},{interval_seconds:-1},{timezone:"missing/zone"},{media_mode:"invalid"},{button_message:""},{ai_enabled:true,ai_instructions:""}])("rejects unsafe or incomplete settings %j",patch=>{
    expect(validateLibraryRules({...defaultLibraryRules,...patch} as typeof defaultLibraryRules)).not.toBeNull();
  });
  it("has named Gemini, sending format and scheduling controls",()=>{
    render(<LibraryRulesForm libraryId="one" initial={defaultLibraryRules} enabled={false}/>);
    expect(screen.getByLabelText("Suas instruções")).toBeInTheDocument();
    expect(screen.getByLabelText("Organização das mídias")).toHaveValue("album");
    fireEvent.change(screen.getByLabelText("Organização das mídias"),{target:{value:"separate"}});
    expect(screen.getByLabelText("Organização das mídias")).toHaveValue("separate");
    expect(screen.getByLabelText("Modo de publicação")).toHaveValue("review");
  });
  it("locks editing while active",()=>{
    render(<LibraryRulesForm libraryId="one" initial={defaultLibraryRules} enabled/>);
    expect(screen.getByLabelText("Suas instruções")).toBeDisabled();
    expect(screen.getByRole("button",{name:"Salvar regras"})).toBeDisabled();
  });
});
