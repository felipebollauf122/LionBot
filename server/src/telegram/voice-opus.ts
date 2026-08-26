import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryCache } from "../cache.js";

/**
 * Conversão de áudio pra MENSAGEM DE VOZ de verdade.
 *
 * A Bot API aceita MP3/M4A em sendVoice, mas o cliente do Telegram só desenha
 * a bolha de onda com play inline quando o arquivo é OGG/OPUS: qualquer outro
 * container ele degrada pro player de arquivo com nome e tamanho (o
 * "6mAQ….mp3" que aparecia no chat). Então transcodificamos com ffmpeg pro
 * formato nativo de voz — mono, 48kHz, OPUS — antes de subir.
 *
 * Custo: só no primeiro envio de cada (bot, URL). O file_id devolvido pelo
 * Telegram fica em cache e os leads seguintes recebem o áudio por referência,
 * sem download nem transcode.
 */

const FFMPEG_BIN = process.env.FFMPEG_PATH ?? "ffmpeg";
/** Áudio de bolha de voz é curto; acima disso não vale segurar na memória. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const FFMPEG_TIMEOUT_MS = 60_000;

/** file_id do áudio já convertido, por (bot, URL de origem). file_id não
 *  expira, mas é preso ao bot — daí o token entrar na chave. */
const voiceFileIdCache = new MemoryCache<string>(24 * 60 * 60, 2000);

export function voiceCacheKey(botToken: string, sourceUrl: string): string {
  return createHash("sha256").update(`${botToken}\n${sourceUrl}`).digest("hex");
}

export function getCachedVoiceFileId(botToken: string, sourceUrl: string): string | undefined {
  return voiceFileIdCache.get(voiceCacheKey(botToken, sourceUrl));
}

export function cacheVoiceFileId(botToken: string, sourceUrl: string, fileId: string): void {
  voiceFileIdCache.set(voiceCacheKey(botToken, sourceUrl), fileId);
}

export function forgetVoiceFileId(botToken: string, sourceUrl: string): void {
  voiceFileIdCache.invalidate(voiceCacheKey(botToken, sourceUrl));
}

let ffmpegProbe: Promise<boolean> | null = null;

/** Testa uma vez por processo se existe ffmpeg no PATH. Sem ele o envio não
 *  quebra — cai no caminho antigo (arquivo cru), só sem a bolha de voz. */
export function ffmpegAvailable(): Promise<boolean> {
  ffmpegProbe ??= new Promise<boolean>((resolve) => {
    const child = spawn(FFMPEG_BIN, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  }).then((ok) => {
    if (!ok) {
      console.warn(
        `[voice] ffmpeg não encontrado (${FFMPEG_BIN}): áudios vão como arquivo, não como bolha de voz. ` +
          "Instale ffmpeg na imagem do worker ou aponte FFMPEG_PATH.",
      );
    }
    return ok;
  });
  return ffmpegProbe;
}

/** Só pros testes: descarta o resultado memoizado da sonda. */
export function resetFfmpegProbe(): void {
  ffmpegProbe = null;
}

/** Roda o ffmpeg num arquivo temporário e devolve o OGG/OPUS pela stdout. */
async function runFfmpeg(inputPath: string): Promise<Buffer> {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-i", inputPath,
    // Sem vídeo (capa embutida de MP3 é "vídeo" pro ffmpeg) e sem metadata:
    // a capa faria o mux de ogg falhar, e a tag só engordaria o arquivo.
    "-vn",
    "-map_metadata", "-1",
    // Perfil nativo de voice note: mono, 48kHz, OPUS em ~32kbps.
    "-ac", "1",
    "-ar", "48000",
    "-c:a", "libopus",
    "-b:a", "32k",
    "-application", "voip",
    "-f", "ogg",
    "pipe:1",
  ];

  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg excedeu ${FFMPEG_TIMEOUT_MS}ms`));
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      // Só o suficiente pra mensagem de erro — stderr do ffmpeg pode ser longo.
      if (err.length < 2000) err += chunk.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffmpeg saiu com código ${code}: ${err.trim() || "(sem stderr)"}`));
        return;
      }
      const buf = Buffer.concat(out);
      if (buf.length === 0) {
        reject(new Error("ffmpeg não produziu saída"));
        return;
      }
      resolve(buf);
    });
  });
}

/** Conversões em voo, por URL: um disparo de remarketing manda o mesmo áudio
 *  pra dezenas de leads ao mesmo tempo, e sem isso cada um subiria um ffmpeg
 *  pro mesmo arquivo antes do primeiro terminar e popular o cache. */
const inFlight = new Map<string, Promise<Buffer | null>>();

/**
 * Baixa a URL e devolve o mesmo áudio em OGG/OPUS. Devolve null quando não dá
 * pra converter (sem ffmpeg, arquivo grande demais, formato ilegível) — quem
 * chama cai no envio cru.
 */
export async function toOpusVoice(sourceUrl: string): Promise<Buffer | null> {
  const running = inFlight.get(sourceUrl);
  if (running) return await running;

  const task = convert(sourceUrl).finally(() => inFlight.delete(sourceUrl));
  inFlight.set(sourceUrl, task);
  return await task;
}

async function convert(sourceUrl: string): Promise<Buffer | null> {
  if (!(await ffmpegAvailable())) return null;

  let dir: string | null = null;
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`falha ao baixar áudio da origem (HTTP ${response.status})`);
    }
    const source = Buffer.from(await response.arrayBuffer());
    if (source.length === 0) throw new Error("origem devolveu arquivo vazio");
    if (source.length > MAX_SOURCE_BYTES) {
      console.warn(
        `[voice] ${sourceUrl} tem ${Math.round(source.length / 1024 / 1024)}MB — acima do teto de conversão, enviando como arquivo.`,
      );
      return null;
    }

    // Arquivo temporário em vez de pipe:0 — M4A/MP4 guardam o índice no fim do
    // arquivo e o ffmpeg precisa poder voltar pro começo pra decodificar.
    dir = await mkdtemp(join(tmpdir(), "eaglebot-voice-"));
    const inputPath = join(dir, "source");
    await writeFile(inputPath, source);

    const opus = await runFfmpeg(inputPath);
    console.log(
      `[voice] convertido pra OGG/OPUS: ${Math.round(source.length / 1024)}KB → ${Math.round(opus.length / 1024)}KB (${sourceUrl})`,
    );
    return opus;
  } catch (error) {
    console.warn(
      `[voice] conversão pra voz falhou (${error instanceof Error ? error.message : String(error)}); enviando o arquivo original.`,
    );
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
