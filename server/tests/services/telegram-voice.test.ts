import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// toOpusVoice roda ffmpeg de verdade — aqui só interessa o caminho que a
// api.ts toma com/sem conversão, então o transcode é dublado.
vi.mock("../../src/telegram/voice-opus.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/telegram/voice-opus.js")>();
  return { ...actual, toOpusVoice: vi.fn() };
});

import { TelegramApi } from "../../src/telegram/api.js";
import { toOpusVoice, forgetVoiceFileId } from "../../src/telegram/voice-opus.js";

const TOKEN = "123:test-token";
const OK = (result: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, result }),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(toOpusVoice).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Corpo da chamada nº i, já desserializado (JSON ou FormData). */
function callBody(i: number): FormData | Record<string, unknown> {
  const init = fetchMock.mock.calls[i][1] as RequestInit;
  return init.body instanceof FormData ? init.body : JSON.parse(init.body as string);
}

describe("TelegramApi.sendVoice", () => {
  it("converte pra OGG/OPUS e sobe como voice.ogg", async () => {
    const url = "https://cdn.test/opus-upload.mp3";
    forgetVoiceFileId(TOKEN, url);
    vi.mocked(toOpusVoice).mockResolvedValue(Buffer.from("OggS-fake"));
    fetchMock.mockResolvedValue(OK({ message_id: 7, chat: { id: 1 }, voice: { file_id: "FID-1" } }));

    const sent = await new TelegramApi(TOKEN).sendVoice({ chatId: 1, voice: url, duration: 3 });

    expect(sent?.message_id).toBe(7);
    expect(fetchMock.mock.calls[0][0]).toContain("/sendVoice");
    const form = callBody(0) as FormData;
    const file = form.get("voice") as File;
    expect(file.name).toBe("voice.ogg");
    expect(form.get("duration")).toBe("3");
    forgetVoiceFileId(TOKEN, url);
  });

  it("reusa o file_id no segundo envio, sem reconverter", async () => {
    const url = "https://cdn.test/cache-hit.mp3";
    forgetVoiceFileId(TOKEN, url);
    vi.mocked(toOpusVoice).mockResolvedValue(Buffer.from("OggS-fake"));
    fetchMock.mockResolvedValue(OK({ message_id: 8, chat: { id: 1 }, voice: { file_id: "FID-2" } }));

    const api = new TelegramApi(TOKEN);
    await api.sendVoice({ chatId: 1, voice: url });
    await api.sendVoice({ chatId: 2, voice: url });

    expect(toOpusVoice).toHaveBeenCalledTimes(1);
    expect(callBody(1)).toMatchObject({ chat_id: 2, voice: "FID-2" });
    forgetVoiceFileId(TOKEN, url);
  });

  it("sem ffmpeg, cai no envio do arquivo original", async () => {
    const url = "https://cdn.test/no-ffmpeg.mp3";
    forgetVoiceFileId(TOKEN, url);
    vi.mocked(toOpusVoice).mockResolvedValue(null);
    fetchMock.mockResolvedValue(OK({ message_id: 9, chat: { id: 1 } }));

    await new TelegramApi(TOKEN).sendVoice({ chatId: 1, voice: url });

    expect(callBody(0)).toMatchObject({ voice: url });
  });

  it("file_id como origem vai direto, sem download nem conversão", async () => {
    const fileId = "BQACAgEAAxkBAAIB_file_id_longo";
    fetchMock.mockResolvedValue(OK({ message_id: 10, chat: { id: 1 } }));

    await new TelegramApi(TOKEN).sendVoice({ chatId: 1, voice: fileId });

    expect(toOpusVoice).not.toHaveBeenCalled();
    expect(callBody(0)).toMatchObject({ voice: fileId });
  });
});
