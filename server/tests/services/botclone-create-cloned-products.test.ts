import { describe, it, expect, vi } from "vitest";
import { createClonedProductsAndBundles } from "../../src/services/mtproto/bot-clone/create-cloned-products.js";
import type { PriceCandidate } from "../../src/services/mtproto/bot-clone/price-candidates.js";

type TableResult = { data: { id: string } | null; error: { message: string } | null };

function fakeDb(resultsByTable: Record<string, TableResult[]>) {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const cursors: Record<string, number> = {};
  const db = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        calls.push({ table, row });
        const results = resultsByTable[table] ?? [];
        const i = cursors[table] ?? 0;
        cursors[table] = i + 1;
        const result = results[i] ?? results[results.length - 1] ?? { data: null, error: { message: "no fake result configured" } };
        return {
          select: () => ({
            single: async () => result,
          }),
          // product_bundle_items não encadeia .select().single() no código real — resolve direto.
          then: (resolve: (v: TableResult) => void) => resolve(result),
        };
      },
    }),
  };
  return { db: db as unknown as Parameters<typeof createClonedProductsAndBundles>[0], calls };
}

function candidate(over: Partial<PriceCandidate> = {}): PriceCandidate {
  return { dedupKey: "vip mensal por r$ 15.93", label: "Vip Mensal por R$ 15.93", cents: 1593, ...over };
}

describe("createClonedProductsAndBundles", () => {
  it("caminho feliz: 1 candidato vira 1 produto + 1 bundle + 1 item, Map devolvido com a chave certa", async () => {
    const { db, calls } = fakeDb({
      products: [{ data: { id: "prod-1" }, error: null }],
      product_bundles: [{ data: { id: "bundle-1" }, error: null }],
      product_bundle_items: [{ data: null, error: null }],
    });

    const result = await createClonedProductsAndBundles(db, { tenantId: "t1", botId: "b1" }, new Map([[candidate().dedupKey, candidate()]]));

    expect(result.get("vip mensal por r$ 15.93")).toBe("bundle-1");
    expect(calls.find((c) => c.table === "products")?.row).toMatchObject({
      tenant_id: "t1",
      bot_id: "b1",
      name: "Vip Mensal por R$ 15.93",
      price: 1593,
      currency: "BRL",
      is_active: true,
    });
    expect(calls.find((c) => c.table === "product_bundles")?.row).toMatchObject({ name: "Vip Mensal por R$ 15.93", is_active: true });
    expect(calls.find((c) => c.table === "product_bundle_items")?.row).toEqual({ bundle_id: "bundle-1", product_id: "prod-1", sort_order: 0 });
  });

  it("falha ao criar o produto: candidato fica fora do Map, sem lançar", async () => {
    const { db } = fakeDb({
      products: [{ data: null, error: { message: "insert falhou" } }],
    });

    const result = await createClonedProductsAndBundles(db, { tenantId: "t1", botId: "b1" }, new Map([[candidate().dedupKey, candidate()]]));

    expect(result.size).toBe(0);
  });

  it("produto criado mas bundle falha: candidato fora do Map, produto órfão tolerado (sem lançar)", async () => {
    const { db } = fakeDb({
      products: [{ data: { id: "prod-1" }, error: null }],
      product_bundles: [{ data: null, error: { message: "insert falhou" } }],
    });

    const result = await createClonedProductsAndBundles(db, { tenantId: "t1", botId: "b1" }, new Map([[candidate().dedupKey, candidate()]]));

    expect(result.size).toBe(0);
  });

  it("múltiplos candidatos: cada um vira sua própria linha e entrada no Map", async () => {
    const { db } = fakeDb({
      products: [{ data: { id: "prod-1" }, error: null }, { data: { id: "prod-2" }, error: null }],
      product_bundles: [{ data: { id: "bundle-1" }, error: null }, { data: { id: "bundle-2" }, error: null }],
      product_bundle_items: [{ data: null, error: null }],
    });

    const c1 = candidate();
    const c2 = candidate({ dedupKey: "vip mensal por r$ 13.54", label: "Vip Mensal por R$ 13.54", cents: 1354 });
    const result = await createClonedProductsAndBundles(
      db,
      { tenantId: "t1", botId: "b1" },
      new Map([[c1.dedupKey, c1], [c2.dedupKey, c2]]),
    );

    expect(result.size).toBe(2);
    expect(result.get(c1.dedupKey)).toBe("bundle-1");
    expect(result.get(c2.dedupKey)).toBe("bundle-2");
  });
});
