import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloneMapRow } from "./types.js";

/** The message map is the durable record; counters can lag after a crash. */
export function createCloneProgressStore(db: SupabaseClient, jobId: string) {
  async function load() {
    const { data: job } = await db.from("clone_jobs")
      .select("cursor_source_msg_id").eq("id", jobId).single().throwOnError();
    let cursor = Number(job!.cursor_source_msg_id ?? 0);
    const idMap: Array<[number, number]> = [];
    const counters = { copied: 0, skipped: 0, failed: 0, seen: 0 };
    let after = 0;
    for (;;) {
      const { data } = await db.from("clone_message_map")
        .select("source_msg_id, dest_msg_id, status").eq("job_id", jobId)
        .gt("source_msg_id", after).order("source_msg_id", { ascending: true })
        .limit(1000).throwOnError();
      // Continue even after a short page: PostgREST may impose a smaller cap.
      if (!data?.length) break;
      for (const row of data) {
        const sourceId = Number(row.source_msg_id);
        cursor = Math.max(cursor, sourceId);
        counters.seen++;
        if (row.status === "copied") {
          counters.copied++;
          if (row.dest_msg_id !== null) idMap.push([sourceId, Number(row.dest_msg_id)]);
        } else if (row.status === "skipped") counters.skipped++;
        else counters.failed++;
      }
      after = Number(data[data.length - 1].source_msg_id);
    }
    return { cursor, idMap, counters };
  }

  async function saveCursor(cursor: number) {
    await db.from("clone_jobs").update({ cursor_source_msg_id: cursor })
      .eq("id", jobId).select("id").single().throwOnError();
  }

  async function persist(rows: CloneMapRow[], cursor: number) {
    if (rows.length) {
      await db.from("clone_message_map").upsert(rows.map((row) => ({
        job_id: jobId,
        source_msg_id: row.sourceMsgId,
        dest_msg_id: row.destMsgId,
        grouped_id: row.groupedId,
        status: row.status,
        reason: row.reason,
      })), { onConflict: "job_id,source_msg_id" }).throwOnError();
    }
    // Never advance past a failed map write. load() recovers the opposite gap.
    await saveCursor(cursor);
  }

  return { load, persist, saveCursor };
}
