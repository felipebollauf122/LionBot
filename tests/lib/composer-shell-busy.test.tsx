import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SocialProofComposer } from "@/components/dashboard/social-proof/composer";
import type { SocialProofChannel } from "@/lib/types/database";

/**
 * A regressão que os oito testes de `social-proof-*` não conseguem enxergar:
 * NENHUM deles renderiza `ComposerShell` ou `SocialProofComposer`.
 *
 * Antes do refactor a Prova Social tinha UM `useTransition`, e salvar o canal
 * travava a tela inteira. O refactor separou em dois — um dentro do
 * `ComposerShell`, outro no `SocialProofComposer` —, e durante um salvamento
 * do canal a prévia, a composição rápida e o editor voltaram a ficar vivos.
 * Na configuração inicial (canal ainda não existe no banco) isso deixa mandar
 * uma mensagem antes da linha do canal existir, e o usuário recebe
 * "Salve os dados do canal antes de criar mensagens." — um erro que a UI
 * antiga tornava inalcançável.
 *
 * Este arquivo testa no nível do adaptador + shell, que é onde o defeito
 * mora. Os oito arquivos `social-proof-*` continuam intocados.
 */

vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "mock-tgc-font-inter" }),
  Roboto: () => ({ variable: "mock-tgc-font-roboto" }),
}));

/** Resolve o `saveChannel` no momento em que o teste quiser. */
let liberarSalvamento: (() => void) | null = null;

vi.mock("@/lib/actions/social-proof-actions", () => ({
  saveChannel: vi.fn(
    () =>
      new Promise((resolve) => {
        liberarSalvamento = () => resolve({ ok: true });
      }),
  ),
  saveMessage: vi.fn(async () => ({ ok: true })),
  deleteMessage: vi.fn(async () => ({ ok: true })),
  duplicateMessage: vi.fn(async () => ({ ok: true })),
  setPinnedMessage: vi.fn(async () => ({ ok: true })),
  reorderMessages: vi.fn(async () => ({ ok: true })),
}));

function canal(): SocialProofChannel {
  return {
    id: "ch-1",
    tenant_id: "t-1",
    bot_id: "bot-1",
    title: "Canal",
    avatar_url: null,
    subscribers_label: "1,2 mil inscritos",
    is_verified: false,
    is_active: true,
    owner_name: "Dono",
    owner_avatar_url: null,
    owner_username: "dono",
    pinned_message_id: null,
    unread_badge: 0,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function botaoEnviar(): HTMLButtonElement {
  return screen.getByLabelText("Enviar") as HTMLButtonElement;
}

function botaoNovaMensagem(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Nova mensagem detalhada/ }) as HTMLButtonElement;
}

/**
 * Resolve o salvamento em voo e deixa o React assentar.
 *
 * Chamado no fim de TODO teste: o React 19 entrelaça as atualizações de
 * transition numa lane só, e uma ação assíncrona pendurada de um teste
 * anterior prende essa lane — o teste seguinte nunca sai de "ocupado", com
 * uma falha que parece do componente e é do harness.
 */
async function concluirSalvamento(): Promise<void> {
  if (!liberarSalvamento) return;
  await act(async () => {
    liberarSalvamento?.();
    // Um tick de macrotask: uma microtask sozinha não fecha o transition.
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("ComposerShell — a tela inteira trava enquanto o adaptador salva", () => {
  beforeEach(() => {
    liberarSalvamento = null;
  });

  it("trava a composição rápida e a 'nova mensagem' durante o salvamento, e solta depois", async () => {
    render(<SocialProofComposer botId="bot-1" channel={canal()} messages={[]} />);

    expect(botaoEnviar().disabled).toBe(false);
    expect(botaoNovaMensagem().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }));

    await waitFor(() => expect(botaoEnviar().disabled).toBe(true));
    expect(botaoNovaMensagem().disabled).toBe(true);

    await concluirSalvamento();

    expect(botaoEnviar().disabled).toBe(false);
    expect(botaoNovaMensagem().disabled).toBe(false);
  });

  it("o editor aberto também para durante o salvamento do canal", async () => {
    render(<SocialProofComposer botId="bot-1" channel={canal()} messages={[]} />);

    fireEvent.click(botaoNovaMensagem());
    // O "Excluir" do cabeçalho do editor carrega o mesmo `disabled={saving}`
    // do botão de salvar e tem rótulo estável (o de salvar troca o texto pra
    // "Salvando…" justamente quando trava).
    const excluir = (await screen.findByLabelText("Excluir")) as HTMLButtonElement;
    expect(excluir.disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }));

    await waitFor(() =>
      expect((screen.getByLabelText("Excluir") as HTMLButtonElement).disabled).toBe(true),
    );

    await concluirSalvamento();
  });

  it("as ações de linha da prévia também param durante o salvamento", async () => {
    // A terceira peça que o `useTransition` único cobria: o FeedPreview
    // recebe `disabled` e é ele que apaga/duplica/fixa uma bolha.
    const { container } = render(
      <SocialProofComposer
        botId="bot-1"
        channel={canal()}
        messages={[
          {
            id: "m1",
            tenant_id: "t-1",
            bot_id: "bot-1",
            channel_id: "ch-1",
            sender_name: "Dono",
            sender_avatar_url: null,
            content_text: "Oi",
            media_url: null,
            media_type: null,
            offset_seconds: 600,
            views_count: 0,
            position: 1,
            is_active: true,
            sender_kind: "owner",
            kind: "text",
            media: [],
            reactions: [],
            reply_to_id: null,
            display_time: null,
            created_at: "2026-01-01T00:00:00Z",
          },
        ]}
      />,
    );

    const acoesDaLinha = () =>
      container.querySelector(".tg-row__actions button") as HTMLButtonElement;
    expect(acoesDaLinha().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Salvar$/ }));

    await waitFor(() => expect(acoesDaLinha().disabled).toBe(true));

    await concluirSalvamento();
  });
});
