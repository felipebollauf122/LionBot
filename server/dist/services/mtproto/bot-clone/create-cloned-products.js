/**
 * Cria produto + bundle de 1 item por preço distinto encontrado na
 * clonagem. Best-effort por candidato (mesmo padrão de tolerância do resto
 * de bot-clone-handler.ts) — falha num candidato não aborta os demais nem
 * o job; o botão correspondente simplesmente cai no fallback unmapped em
 * transcript-to-flow.ts (a chave dele nunca entra no Map devolvido aqui).
 */
export async function createClonedProductsAndBundles(db, params, candidates) {
    const bundleIds = new Map();
    for (const candidate of candidates.values()) {
        const { data: product, error: productErr } = await db
            .from("products")
            .insert({
            tenant_id: params.tenantId,
            bot_id: params.botId,
            name: candidate.label,
            price: candidate.cents,
            currency: "BRL",
            is_active: true,
        })
            .select("id")
            .single();
        if (productErr || !product) {
            console.error(`[botclone.create-products] insert products falhou pro rótulo "${candidate.label}":`, productErr?.message);
            continue;
        }
        const { data: bundle, error: bundleErr } = await db
            .from("product_bundles")
            .insert({
            tenant_id: params.tenantId,
            bot_id: params.botId,
            name: candidate.label,
            is_active: true,
        })
            .select("id")
            .single();
        if (bundleErr || !bundle) {
            console.error(`[botclone.create-products] insert product_bundles falhou pro rótulo "${candidate.label}":`, bundleErr?.message);
            continue;
        }
        const { error: itemErr } = await db.from("product_bundle_items").insert({
            bundle_id: bundle.id,
            product_id: product.id,
            sort_order: 0,
        });
        if (itemErr) {
            console.error(`[botclone.create-products] insert product_bundle_items falhou pro rótulo "${candidate.label}":`, itemErr.message);
            continue;
        }
        bundleIds.set(candidate.dedupKey, bundle.id);
    }
    return bundleIds;
}
