import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CreateBotForm } from "@/components/dashboard/create-bot-form";

const push = vi.fn();
let supabaseFake: ReturnType<typeof criarFake>;

vi.mock("@/lib/supabase/client", () => ({ createClient: () => supabaseFake.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/lib/actions/flow-actions", () => ({ seedLoginBotFlow: vi.fn(async () => ({ flowId: "f1" })) }));
vi.mock("@/lib/actions/sync-bot-actions", () => ({ syncBotFromTelegram: vi.fn(async () => ({ ok: true })) }));

/** Fake encadeável: registra os inserts e devolve o bot já existente, se houver. */
function criarFake(existente: { id: string } | null) {
  const insert = vi.fn(() => ({
    select: () => ({ single: async () => ({ data: { id: "bot-novo" }, error: null }) }),
  }));
  const from = vi.fn(() => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: existente, error: null });
    q.update = () => q;
    q.insert = insert;
    return q;
  });
  return {
    insert,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from,
    } as never,
  };
}

const TOKEN = "123456789:ABCdefGhIjKlmNoPqRsTuVwXyZ";

function montar(existente: { id: string } | null = null) {
  supabaseFake = criarFake(existente);
  const { container } = render(<CreateBotForm />);
  fireEvent.change(screen.getByPlaceholderText(/123456789/), { target: { value: TOKEN } });
  return container.querySelector("form")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { username: "lojabot" } }), { status: 200 })),
  );
});

describe("CreateBotForm — criar o bot uma vez só", () => {
  // `loading` e estado do React: so desabilita o botao no proximo render.
  // Clique duplo e Enter no input passam antes disso, e cada passagem inseria
  // uma linha nova — daí os bots repetidos.
  it("dois envios seguidos criam um bot só", async () => {
    const form = montar();
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(supabaseFake.insert).toHaveBeenCalledTimes(1);
  });

  // Mesmo padrao de `startAddAccount`, que reaproveita a conta em vez de
  // tentar inserir outra. Quem reenvia o mesmo token quer o mesmo bot.
  it("reaproveita o bot quando o token já está cadastrado", async () => {
    const form = montar({ id: "bot-existente" });
    fireEvent.submit(form);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(supabaseFake.insert).not.toHaveBeenCalled();
  });

  // `router.push` nao e esperado: sem isso o `finally` reabilitava o botao
  // ainda na tela do formulario, e o proximo clique criava o bot de novo.
  it("mantém o botão travado enquanto a navegação acontece", async () => {
    const form = montar();
    fireEvent.submit(form);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /criar bot|criando|validando|ajustando/i })).toBeDisabled();
  });

  it("libera para nova tentativa quando dá erro, mostrando o motivo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })),
    );
    const form = montar();
    fireEvent.submit(form);
    expect(await screen.findByText(/token inv[aá]lido/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /criar bot/i })).not.toBeDisabled(),
    );
    expect(supabaseFake.insert).not.toHaveBeenCalled();
  });

  it("não deixa o Telegram travar o envio para sempre", async () => {
    const chamada = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ ok: true, result: { username: "b" } })),
    );
    vi.stubGlobal("fetch", chamada);
    const form = montar();
    fireEvent.submit(form);
    await waitFor(() => expect(chamada).toHaveBeenCalled());
    expect(chamada.mock.calls[0][1]?.signal).toBeDefined();
  });
});
