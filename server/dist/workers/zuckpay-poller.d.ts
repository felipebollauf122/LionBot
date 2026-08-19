import type { SupabaseClient } from "@supabase/supabase-js";
export declare function pollZuckpayPendingTransactions(db: SupabaseClient): Promise<void>;
