import {describe,it,expect,vi} from "vitest";
import {render,screen,fireEvent} from "@testing-library/react";
import {defaultLibraryRules,validateLibraryRules} from "@/lib/automations/library-types";
import {LibraryRulesForm} from "@/components/dashboard/automations/library-rules";
import {LibrarySources} from "@/components/dashboard/automations/library-sources";
vi.mock("@/app/dashboard/automations/scheduled/libraries/actions",()=>({saveLibraryRules:vi.fn(async()=>({ok:true})),reprocessLibraryDrafts:vi.fn(async()=>({ok:true})),addLibrarySource:vi.fn(async()=>({ok:true})),setLibrarySourcePaused:vi.fn(async()=>({ok:true}))}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn(),push:vi.fn()}),useSearchParams:()=>new URLSearchParams(),usePathname:()=>"/dashboard/automations/scheduled/libraries/l1/sources"}));
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

/**
 * A primeira automação de verdade ficou parada sem ninguém entender por quê:
 * origem adicionada, regras salvas, e a lista mostrava "Aguardando" — que
 * lê como "processando". Faltava ATIVAR, e a tela não dizia isso em lugar
 * nenhum perto da origem.
 */
describe("origens deixam claro que nada é coletado com a automação pausada",()=>{
  const origem=[{id:"s1",library_id:"l1",source_dialog_id:"d1",import_history:true,watch:false,status:"pending",cursor_message_id:0,imported_count:0,last_error:null}];
  const dialogos=[{id:"d1",title:"Canal de origem",account:"+55",peer_id:"1",peer_type:"channel"}];

  it("pausada: avisa que a coleta não começou e aponta o botão de ativar",()=>{
    render(<LibrarySources libraryId="l1" sources={origem} dialogs={dialogos} enabled={false}/>);
    expect(screen.getByRole("status")).toHaveTextContent(/pausada/i);
    expect(screen.getByRole("status")).toHaveTextContent(/Ativar automação/i);
    expect(screen.getByText(/Aguardando a automação ser ativada/i)).toBeInTheDocument();
  });

  it("ativa: nenhum aviso de pausa, e a origem aparece na fila de coleta",()=>{
    render(<LibrarySources libraryId="l1" sources={origem} dialogs={dialogos} enabled/>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Na fila para coletar/i)).toBeInTheDocument();
  });
});
