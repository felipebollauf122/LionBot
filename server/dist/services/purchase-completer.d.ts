import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "../engine/types.js";
interface Bot {
    id: string;
    tenant_id: string;
    telegram_token: string;
    protect_content: boolean;
    payment_gateway: string | null;
    facebook_pixel_id: string | null;
    facebook_access_token: string | null;
    facebook_pixel_id_backup: string | null;
    facebook_access_token_backup: string | null;
    facebook_backup_enabled: boolean | null;
    utmify_api_key: string | null;
    sigilopay_public_key: string | null;
    sigilopay_secret_key: string | null;
    evpay_api_key: string | null;
    evpay_project_id: string | null;
}
interface Transaction {
    id: string;
    tenant_id: string;
    lead_id: string;
    bot_id: string;
    flow_id: string;
    product_id: string;
    amount: number;
    currency: string;
    paid_at?: string | null;
    sent_to_facebook?: boolean | null;
}
export declare function completePurchase(db: SupabaseClient, bot: Bot, lead: Lead, transaction: Transaction, opts?: {
    force?: boolean;
}): Promise<void>;
export declare function isValidEmail(s: string): boolean;
export {};
