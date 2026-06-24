import type { SupabaseClient } from "@supabase/supabase-js";
/**
 * Process remarketing for all active configs.
 * Called on interval from queue.ts.
 */
export declare function processRemarketing(db: SupabaseClient): Promise<void>;
