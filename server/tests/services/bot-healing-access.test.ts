import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), query: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("../../src/db.js", () => ({ supabase: { from: mocks.from } }));
import { tenantHasHealing } from "../../src/services/bot-healing/access.js";

/** Cada teste usa um tenant próprio: o cache é de módulo e não se reseta entre eles. */
let seq = 0;
const novoTenant = () => `10000000-0000-0000-0000-00000000${String(++seq).padStart(4, "0")}`;

function responde(resposta: { data: unknown; error: unknown }) {
  mocks.query = Object.fromEntries(["select", "eq"].map(name => [name, vi.fn(() => mocks.query)]));
  mocks.query.maybeSingle = vi.fn(async () => resposta);
  mocks.from.mockReturnValue(mocks.query);
}

beforeEach(() => vi.clearAllMocks());

describe("quem pode usar a recuperação de bots", () => {
  it("libera o assinante premium", async () => {
    responde({ data: { is_owner: false, is_premium: true }, error: null });
    await expect(tenantHasHealing(novoTenant())).resolves.toBe(true);
  });

  it("libera o owner da instância, que não precisa assinar", async () => {
    responde({ data: { is_owner: true, is_premium: false }, error: null });
    await expect(tenantHasHealing(novoTenant())).resolves.toBe(true);
  });

  it("recusa quem perdeu o premium", async () => {
    responde({ data: { is_owner: false, is_premium: false }, error: null });
    await expect(tenantHasHealing(novoTenant())).resolves.toBe(false);
  });

  it("recusa um tenant que não existe mais", async () => {
    responde({ data: null, error: null });
    await expect(tenantHasHealing(novoTenant())).resolves.toBe(false);
  });

  // Uma falha de leitura tem que subir: virar `false` desligaria a recuperação
  // de todo mundo no primeiro soluço do banco, e em silêncio.
  it("não transforma falha de leitura em recusa silenciosa", async () => {
    responde({ data: null, error: { message: "boom" } });
    const tenant = novoTenant();
    await expect(tenantHasHealing(tenant)).rejects.toThrow("healing_access_read_failed");
    // E não deixa o erro virar uma entrada de cache: a próxima tentativa relê.
    responde({ data: { is_owner: false, is_premium: true }, error: null });
    await expect(tenantHasHealing(tenant)).resolves.toBe(true);
  });

  // O scan roda a cada 60s sobre a frota inteira; sem cache seria uma leitura
  // de `tenants` por bot por minuto.
  it("reaproveita a resposta dentro do TTL em vez de reler a cada bot da varredura", async () => {
    responde({ data: { is_owner: false, is_premium: true }, error: null });
    const tenant = novoTenant();
    await tenantHasHealing(tenant);
    await tenantHasHealing(tenant);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("lê apenas as colunas de plano", async () => {
    responde({ data: { is_owner: false, is_premium: true }, error: null });
    await tenantHasHealing(novoTenant());
    expect(mocks.from).toHaveBeenCalledWith("tenants");
    expect(mocks.query.select).toHaveBeenCalledWith("is_owner,is_premium");
  });
});
