import type { TelegramClient } from "telegram";
import type { SupabaseClient } from "@supabase/supabase-js";
export interface MediaRehostDeps {
    raw: TelegramClient;
    supabase: SupabaseClient;
}
export interface DownloadAndRehostInput {
    media: unknown;
    tenantId: string;
    jobId: string;
    nodeIdHint: string;
    fileName: string;
    tmpDir: string;
    maxBytes: number;
}
/** Devolve a URL pública, ou null se a mídia passar do teto de tamanho. */
export declare function downloadAndRehostMedia(deps: MediaRehostDeps, input: DownloadAndRehostInput): Promise<string | null>;
