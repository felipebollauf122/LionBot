import { describe, it, expect, vi } from "vitest";
import { Api } from "telegram";
import { MtprotoClient } from "../../src/services/mtproto/client.js";

/**
 * Issue 3 do re-review: promoteBotToAdmin passou a engolir
 * USER_ALREADY_PARTICIPANT/USER_ALREADY_INVITED do InviteToChannel pra
 * garantir que o EditAdmin SEMPRE rode em seguida (um bot que já é membro
 * mas não é admin precisa ser promovido do mesmo jeito) — e esse caminho,
 * fatal e sem retry, não tinha nenhuma cobertura.
 *
 * `client` (o TelegramClient real) é privado em MtprotoClient e não tem
 * seam de injeção — `private` do TypeScript é só compile-time, então
 * substituímos via cast `as any` depois de construir a instância, sem
 * mudar nada de client.ts. O fake abaixo só precisa responder ao que
 * promoteBotToAdmin realmente chama: connect() implícito (via `connected:
 * true`, pulando o client.connect() real), getInputEntity() e invoke().
 */
interface FakeClient {
  connected: boolean;
  connect: ReturnType<typeof vi.fn>;
  getInputEntity: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
}

function makeFakeClient(inviteError: unknown | null): FakeClient {
  const invoke = vi.fn(async (request: unknown) => {
    if (request instanceof Api.channels.InviteToChannel) {
      if (inviteError) throw inviteError;
      return {};
    }
    if (request instanceof Api.channels.EditAdmin) {
      return {};
    }
    throw new Error(`request inesperado no fake invoke: ${String(request)}`);
  });
  return {
    connected: true, // pula o `await this.client.connect()` real dentro de MtprotoClient.connect()
    connect: vi.fn(async () => {}),
    getInputEntity: vi.fn(async () => ({ userId: "bot-input-entity" })),
    invoke,
  };
}

function makeClientWithFake(inviteError: unknown | null): { client: MtprotoClient; fake: FakeClient } {
  const client = new MtprotoClient(1, "fake-hash", "");
  const fake = makeFakeClient(inviteError);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).client = fake;
  return { client, fake };
}

function inviteCalls(fake: FakeClient): unknown[] {
  return fake.invoke.mock.calls
    .map((c) => c[0])
    .filter((r) => r instanceof Api.channels.InviteToChannel);
}

function editAdminCalls(fake: FakeClient): unknown[] {
  return fake.invoke.mock.calls
    .map((c) => c[0])
    .filter((r) => r instanceof Api.channels.EditAdmin);
}

describe("MtprotoClient.promoteBotToAdmin (tolerância de convite)", () => {
  it("quando InviteToChannel rejeita com USER_ALREADY_PARTICIPANT, EditAdmin AINDA roda", async () => {
    const { client, fake } = makeClientWithFake(new Error("USER_ALREADY_PARTICIPANT (400)"));
    await client.promoteBotToAdmin("123", "456", "meu_bot");
    expect(inviteCalls(fake)).toHaveLength(1);
    expect(editAdminCalls(fake)).toHaveLength(1);
  });

  it("quando InviteToChannel rejeita com USER_ALREADY_INVITED, EditAdmin AINDA roda", async () => {
    const { client, fake } = makeClientWithFake(new Error("USER_ALREADY_INVITED (400)"));
    await client.promoteBotToAdmin("123", "456", "meu_bot");
    expect(editAdminCalls(fake)).toHaveLength(1);
  });

  it("quando InviteToChannel tem sucesso, EditAdmin roda uma vez", async () => {
    const { client, fake } = makeClientWithFake(null);
    await client.promoteBotToAdmin("123", "456", "meu_bot");
    expect(inviteCalls(fake)).toHaveLength(1);
    expect(editAdminCalls(fake)).toHaveLength(1);
  });

  it("quando InviteToChannel rejeita com erro NÃO tolerado, o método propaga e EditAdmin NÃO roda", async () => {
    const { client, fake } = makeClientWithFake(new Error("BOT_GROUPS_BLOCKED (400)"));
    await expect(client.promoteBotToAdmin("123", "456", "meu_bot")).rejects.toThrow(
      "BOT_GROUPS_BLOCKED",
    );
    expect(editAdminCalls(fake)).toHaveLength(0);
  });
});
