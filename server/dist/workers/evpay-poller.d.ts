import type { SupabaseClient } from "@supabase/supabase-js";
export declare function pollEvpayPendingTransactions(db: SupabaseClient): Promise<void>;
