import path from "node:path";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { downloadMediaToPath } from "../download-media.js";
/**
 * Baixa mídia do bot-alvo via MTProto e re-hospeda no bucket "media" do
 * Supabase Storage (mesmo bucket que image.ts/video.ts já consomem, mesmo
 * padrão de upload de lib/actions/sync-bot-actions.ts) — devolve uma URL
 * pública estável que um nó de fluxo pode guardar de forma permanente
 * (um file_id do Telegram só é reusável dentro do MESMO bot, não serviria
 * pro bot de destino).
 */
const CONTENT_TYPE_BY_EXT = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    pdf: "application/pdf",
};
function guessContentType(fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}
async function ensureMediaBucket(supabase) {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.id === "media")) {
        await supabase.storage.createBucket("media", { public: true });
    }
}
/** Devolve a URL pública, ou null se a mídia passar do teto de tamanho. */
export async function downloadAndRehostMedia(deps, input) {
    await mkdir(input.tmpDir, { recursive: true });
    const tmpPath = path.join(input.tmpDir, `${input.nodeIdHint}_${input.fileName}`);
    try {
        const size = await downloadMediaToPath(deps.raw, input.media, tmpPath, input.maxBytes);
        if (size === null)
            return null; // grande demais — downloadMediaToPath já limpou o arquivo
        const buf = await readFile(tmpPath);
        const key = `${input.tenantId}/botclone/${input.jobId}/${input.nodeIdHint}_${input.fileName}`;
        await ensureMediaBucket(deps.supabase);
        const { error } = await deps.supabase.storage.from("media").upload(key, buf, {
            contentType: guessContentType(input.fileName),
            upsert: true,
        });
        if (error)
            throw new Error(`upload pro Storage falhou: ${error.message}`);
        return deps.supabase.storage.from("media").getPublicUrl(key).data.publicUrl;
    }
    finally {
        await unlink(tmpPath).catch(() => { });
    }
}
