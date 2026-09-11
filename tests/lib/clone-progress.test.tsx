import {describe,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {CloneProgress} from "@/components/dashboard/clone-progress";
const h=vi.hoisted(()=>({launch:vi.fn(async()=>({ok:true})),pause:vi.fn(async()=>({ok:true}))}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/app/dashboard/automations/clones/actions",()=>({launchClone:h.launch,pauseClone:h.pause,deleteClone:vi.fn(async()=>({ok:true})),listCloneSkipReport:vi.fn(async()=>[])}));
const initial={id:"c",status:"paused",effective_strategy:null,dest_invite_link:null,total_seen:0,copied_count:0,skipped_count:0,failed_count:0,message_limit:null,last_error:null};
describe("clone progress controls",()=>{
 it("restarts the live state and polling after a paused job resumes",async()=>{
  render(<CloneProgress initial={initial}/>);
  fireEvent.click(screen.getByRole("button",{name:"Retomar"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Pausar"})).toBeInTheDocument());
  expect(h.launch).toHaveBeenCalledWith("c");
 });
 it("changes to paused as soon as pause succeeds",async()=>{
  render(<CloneProgress initial={{...initial,status:"running"}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Pausar"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Retomar"})).toBeInTheDocument());
 });
});
