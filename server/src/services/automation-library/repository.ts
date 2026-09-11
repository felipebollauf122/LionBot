import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArchivedUnit, Dialog, Item, Library, Processed, Source } from "./types.js";

export async function checked<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const result = await query;
  if (result.error) throw new Error(`Acervo DB: ${result.error.message}`);
  return result.data;
}
export class LibraryRepository {
  constructor(readonly db: SupabaseClient) {}
  async libraries(): Promise<Library[]> {
    const result: Library[] = [];
    let cursor = "";
    for (;;) {
      let q = this.db.from("automation_libraries").select("*").eq("enabled", true).order("id").limit(100);
      if (cursor) q = q.gt("id", cursor);
      const rows = await checked(q) as Library[];
      result.push(...rows);
      if (rows.length < 100) return result;
      cursor = rows.at(-1)!.id;
    }
  }
  async library(id: string, tenant: string): Promise<Library | null> {
    return checked(this.db.from("automation_libraries").select("*").eq("id",id).eq("tenant_id",tenant).maybeSingle());
  }
  async sources(library: Library): Promise<Source[]> {
    const result: Source[] = [];
    let cursor = "";
    for (;;) {
      let q = this.db.from("automation_library_sources").select("*").eq("library_id",library.id)
        .eq("tenant_id",library.tenant_id).order("id").limit(100);
      if (cursor) q = q.gt("id",cursor);
      const rows = await checked(q) as Source[];
      result.push(...rows);
      if (rows.length < 100) return result;
      cursor = rows.at(-1)!.id;
    }
  }
  async source(id: string, tenant: string): Promise<Source | null> {
    return checked(this.db.from("automation_library_sources").select("*").eq("id",id).eq("tenant_id",tenant).maybeSingle());
  }
  async dialog(id: string, tenant: string): Promise<Dialog> {
    const d = await checked(this.db.from("mtproto_dialogs").select("*, mtproto_accounts!inner(tenant_id,status)").eq("id",id).eq("mtproto_accounts.tenant_id",tenant).eq("mtproto_accounts.status","active").maybeSingle()) as Dialog | null;
    if (!d || !["channel","chat"].includes(d.peer_type)) throw new Error("Diálogo não encontrado no tenant ou não é canal/grupo");
    return d;
  }
  async lease(source: Source, watchLane = false): Promise<Source | null> {
    const now = new Date().toISOString();
    const field = watchLane ? "watch_lease_until" : "lease_until";
    let query = this.db.from("automation_library_sources").update({ [field]:new Date(Date.now()+300_000).toISOString() })
      .eq("id",source.id).eq("tenant_id",source.tenant_id).not("status","in","(paused,failed,completed)")
      .or(`${field}.is.null,${field}.lt.${now}`);
    if (watchLane) query = query.eq("watch",true).not("watch_cursor_message_id","is",null);
    const row = await checked(query.select("*").maybeSingle()) as Source | null;
    return row ? { ...row, watch_lane: watchLane } : null;
  }
  async sourcePatch(source: Source, patch: Record<string, unknown>): Promise<Source> {
    const row = await checked(this.db.from("automation_library_sources").update(patch).eq("id",source.id)
      .eq("tenant_id",source.tenant_id).eq(source.watch_lane?"watch_lease_until":"lease_until",source.watch_lane?source.watch_lease_until:source.lease_until)
      .not("status","in","(paused,failed)").select("*").maybeSingle()) as Source | null;
    if (!row) throw new Error("Fonte pausada ou lease perdido");
    return { ...row, watch_lane: source.watch_lane };
  }
  async release(source: Source): Promise<void> {
    const field=source.watch_lane?"watch_lease_until":"lease_until";
    await checked(this.db.from("automation_library_sources").update({[field]:null})
      .eq("id",source.id).eq("tenant_id",source.tenant_id).eq(field,source[field]));
  }
  async insertUnit(source: Source, unit: ArchivedUnit): Promise<void> {
    if (!unit.messages.length) return;
    // A single Postgres insert keeps album membership atomic. On a replay,
    // DO NOTHING retains originals, treatments, approvals and sent receipts.
    await checked(this.db.from("automation_library_items").upsert(unit.messages.map(m => ({
      tenant_id:source.tenant_id, library_id:source.library_id, source_id:source.id,
      source_message_id:m.id, source_grouped_id:m.groupedId, original:m.original, is_live:!!source.watch_lane,
      status:"pending", delivery_status:"draft",
    })), {onConflict:"source_id,source_message_id",ignoreDuplicates:true}));
  }
  async count(source: Source): Promise<number> {
    const {count,error} = await this.db.from("automation_library_items").select("id",{count:"exact",head:true})
      .eq("source_id",source.id).eq("tenant_id",source.tenant_id);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  async pending(library: Library): Promise<Item[]> {
    // A processing claim is safe to recover: Gemini never sends. Its HTTP
    // timeout is 45s; this recovery window is deliberately much larger.
    await checked(this.db.from("automation_library_items").update({status:"pending",processing_started_at:null})
      .eq("library_id",library.id).eq("tenant_id",library.tenant_id).eq("status","processing")
      .lt("processing_started_at",new Date(Date.now()-300_000).toISOString()));
    return await checked(this.db.from("automation_library_items").select("*, automation_library_sources!inner(status)").eq("library_id",library.id)
      .eq("tenant_id",library.tenant_id).neq("automation_library_sources.status","paused")
      .eq("status","pending").order("is_live",{ascending:false}).order("created_at").order("source_message_id").limit(50)) as Item[];
  }
  async album(item: Item): Promise<Item[]> {
    if (!item.source_grouped_id) return [item];
    return await checked(this.db.from("automation_library_items").select("*").eq("source_id",item.source_id)
      .eq("tenant_id",item.tenant_id).eq("library_id",item.library_id)
      .eq("source_grouped_id",item.source_grouped_id).order("source_message_id")) as Item[];
  }
  async claimProcessing(item: Item): Promise<Item | null> {
    return checked(this.db.from("automation_library_items").update({status:"processing",processing_started_at:new Date().toISOString()})
      .eq("id",item.id).eq("tenant_id",item.tenant_id).eq("status","pending")
      .eq("delivery_status","draft").select("*").maybeSingle());
  }
  async finish(item: Item, processed: Processed, rules: unknown): Promise<boolean> {
    return await checked(this.db.rpc("automation_library_finish_processing",{
      p_item_id:item.id,p_started_at:item.processing_started_at,p_processed:processed,p_rules:rules,
    })) as boolean;
  }
  async processingFailed(item: Item, error: string): Promise<void> {
    await checked(this.db.from("automation_library_items").update({status:"failed",last_error:error,processing_started_at:null})
      .eq("id",item.id).eq("tenant_id",item.tenant_id).eq("status","processing")
      .eq("processing_started_at",item.processing_started_at));
  }
  async skipMember(item: Item, leader: string): Promise<void> {
    await checked(this.db.from("automation_library_items").update({status:"skipped",last_error:`album_member:${leader}`})
      .eq("id",item.id).eq("tenant_id",item.tenant_id).eq("status","pending").eq("delivery_status","draft"));
  }
  async claimDue(library: Library): Promise<Item | null> {
    const rows = await checked(this.db.rpc("automation_library_claim_due",{p_library_id:library.id})) as Item[];
    return rows[0] ?? null;
  }
  async deliveryPatch(item: Item, patch: Record<string, unknown>): Promise<void> {
    const row = await checked(this.db.from("automation_library_items").update(patch).eq("id",item.id).eq("tenant_id",item.tenant_id)
      .eq("delivery_status","sending").eq("delivery_claimed_at",item.delivery_claimed_at).select("id").maybeSingle());
    if (!row) throw new Error("Claim de envio perdido; conferir resultado no Telegram antes de reenviar");
  }
  async deferFlood(item: Item, seconds: number): Promise<void> {
    const ok = await checked(this.db.rpc("automation_library_defer_flood",{p_item_id:item.id,p_claimed_at:item.delivery_claimed_at,p_seconds:Math.ceil(seconds)}));
    if (!ok) throw new Error("Claim de flood perdido");
  }
  async libraryError(library: Library, message: string | null): Promise<void> {
    await checked(this.db.from("automation_libraries").update({last_error:message}).eq("id",library.id).eq("tenant_id",library.tenant_id));
  }
}
