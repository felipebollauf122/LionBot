import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({ loadBot: vi.fn(), settings: vi.fn(), schedule: vi.fn(), hasHealing: vi.fn(), from: vi.fn(), query: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("../../src/config.js", () => ({ config: { internalApiSecret: "internal-test-secret", botAutoHealEnabled: true } }));
vi.mock("../../src/db.js", () => ({ supabase: { from: mocks.from } }));
vi.mock("../../src/services/bot-healing/runtime.js", () => ({ loadHealingBot: mocks.loadBot, loadHealingSettings: mocks.settings, scheduleHealingCheck: mocks.schedule }));
vi.mock("../../src/services/bot-healing/access.js", () => ({ tenantHasHealing: mocks.hasHealing }));
import { botHealingRouter } from "../../src/services/bot-healing/routes.js";

const botId = "20000000-0000-0000-0000-000000000001";
const tenantId = "10000000-0000-0000-0000-000000000001";
const accountId = "30000000-0000-0000-0000-000000000001";
let server: Server;
let url: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/bots", botHealingRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/bots/${botId}/auto-healing`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadBot.mockResolvedValue({ id: botId, tenant_id: tenantId, telegram_token: "old-secret", is_active: true });
  mocks.settings.mockResolvedValue({ enabled: true, account_ids: [], backed_up_at: null, identity: null, identity_token_hash: null });
  mocks.schedule.mockResolvedValue(undefined);
  mocks.hasHealing.mockResolvedValue(true);
  mocks.query = Object.fromEntries(["select", "eq", "in", "update", "order", "upsert"].map(name => [name, vi.fn(() => mocks.query)]));
  mocks.query.limit = vi.fn(async () => ({ data: [], error: null }));
  mocks.query.maybeSingle = vi.fn(async () => ({ data: { id: "run-id" }, error: null }));
  mocks.from.mockReturnValue(mocks.query);
});

describe("internal healing endpoints", () => {
  it("rejects missing authorization before accessing bot data", async () => {
    const response = await fetch(`${url}?tenantId=${tenantId}`);
    expect(response.status).toBe(403);
    expect(mocks.loadBot).not.toHaveBeenCalled();
  });
  it("checks the current bot owner", async () => {
    const response = await fetch(`${url}?tenantId=10000000-0000-0000-0000-000000000002`, { headers: { "x-internal-secret": "internal-test-secret" } });
    expect(response.status).toBe(404);
    expect(mocks.settings).not.toHaveBeenCalled();
  });
  it("returns status without tokens, sessions or private identity data", async () => {
    const response = await fetch(`${url}?tenantId=${tenantId}`, { headers: { "x-internal-secret": "internal-test-secret" } });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toMatch(/old-secret|new_token|session_string/);
    expect(JSON.parse(body)).toMatchObject({ workerEnabled: true, enabled: true, identityReady: false });
    expect(mocks.query.select).toHaveBeenCalledWith("id,status,new_username,retry_at,error_code,created_at,updated_at");
  });
  it("rejects account IDs outside the bot tenant without changing settings", async () => {
    mocks.query.in.mockResolvedValue({ data: [], error: null });
    const response = await fetch(url, { method: "POST", headers: { "x-internal-secret": "internal-test-secret", "content-type": "application/json" }, body: JSON.stringify({ tenantId, enabled: true, accountIds: [accountId] }) });
    expect(response.status).toBe(400);
    expect(mocks.query.eq).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(mocks.query.upsert).not.toHaveBeenCalled();
  });
  it("retries only the current credential generation without clearing its saved token/checkpoint", async () => {
    const response = await fetch(`${url}/retry`, { method: "POST", headers: { "x-internal-secret": "internal-test-secret", "content-type": "application/json" }, body: JSON.stringify({ tenantId }) });
    expect(response.status).toBe(202);
    const patch = mocks.query.update.mock.calls[0][0];
    expect(patch).toMatchObject({ status: "queued", retry_at: null, error_code: null });
    expect(patch).not.toHaveProperty("new_token");
    expect(patch).not.toHaveProperty("pending_username");
    expect(mocks.query.eq).toHaveBeenCalledWith("status", "needs_attention");
    expect(mocks.query.eq).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(mocks.schedule).toHaveBeenCalledWith(botId);
  });

  // Sem premium o usuário não vê a tela (o layout de Automações dá notFound),
  // mas a rota é a fronteira real: o painel pode estar em cache, a assinatura
  // pode cair entre o render e o clique, e o segredo interno não sabe de plano.
  it("recusa o tenant sem premium antes de ler as configurações", async () => {
    mocks.hasHealing.mockResolvedValue(false);
    const response = await fetch(`${url}?tenantId=${tenantId}`, { headers: { "x-internal-secret": "internal-test-secret" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "healing_not_available" });
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it("recusa ligar a recuperação sem premium, sem gravar nada", async () => {
    mocks.hasHealing.mockResolvedValue(false);
    const response = await fetch(url, { method: "POST", headers: { "x-internal-secret": "internal-test-secret", "content-type": "application/json" }, body: JSON.stringify({ tenantId, enabled: true, accountIds: [] }) });
    expect(response.status).toBe(403);
    expect(mocks.query.upsert).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  // Plano é lido depois da posse: quem chuta bot de outro tenant continua
  // recebendo 404, sem descobrir de tabela nenhuma se aquele tenant assina.
  it("não revela o plano de outro tenant", async () => {
    const response = await fetch(`${url}?tenantId=10000000-0000-0000-0000-000000000002`, { headers: { "x-internal-secret": "internal-test-secret" } });
    expect(response.status).toBe(404);
    expect(mocks.hasHealing).not.toHaveBeenCalled();
  });

  // Leitura de plano que falha é transitória: 503 e o painel manda tentar de
  // novo, em vez de dizer ao assinante que ele não tem a feature.
  it("trata falha ao ler o plano como indisponibilidade, não como recusa", async () => {
    mocks.hasHealing.mockRejectedValue(new Error("healing_access_read_failed"));
    const response = await fetch(`${url}?tenantId=${tenantId}`, { headers: { "x-internal-secret": "internal-test-secret" } });
    expect(response.status).toBe(503);
  });
});
