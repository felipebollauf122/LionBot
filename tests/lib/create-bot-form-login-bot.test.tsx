import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CreateBotForm } from "@/components/dashboard/create-bot-form";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    from: vi.fn(() => ({
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "bot-1" }, error: null })) })) })),
    })),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/flow-actions", () => ({ seedLoginBotFlow: vi.fn(async () => ({ flowId: "f1" })) }));
vi.mock("@/lib/actions/sync-bot-actions", () => ({ syncBotFromTelegram: vi.fn(async () => ({ ok: true })) }));

const opcaoLoginBot = { name: /bot de login mtproto/i } as const;

describe("CreateBotForm — quem pode criar o bot de login MTProto", () => {
  // O bot de login e a porta de entrada das contas MTProto: e ele que roda o
  // fluxo de telefone + teclado. Escondendo a opcao, o premium tinha a pagina
  // de Automacoes mas nao tinha como conectar conta por bot.
  it("oferece a opção a quem tem as automações", () => {
    render(<CreateBotForm canCreateLoginBot />);
    expect(screen.getByRole("checkbox", opcaoLoginBot)).toBeInTheDocument();
  });

  it("esconde de quem não tem", () => {
    render(<CreateBotForm canCreateLoginBot={false} />);
    expect(screen.queryByRole("checkbox", opcaoLoginBot)).not.toBeInTheDocument();
  });

  // Sem a prop, o formulario e o de criar bot comum.
  it("não oferece por engano quando nada é informado", () => {
    render(<CreateBotForm />);
    expect(screen.queryByRole("checkbox", opcaoLoginBot)).not.toBeInTheDocument();
  });
});
