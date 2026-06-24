import type { SupabaseClient } from "@supabase/supabase-js";
export declare function pollPoseidonPendingTransactions(db: SupabaseClient): Promise<void>;
