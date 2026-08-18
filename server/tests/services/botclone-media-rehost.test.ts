import { describe, it, expect, vi, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { downloadAndRehostMedia } from "../../src/services/mtproto/bot-clone/media-rehost.js";
import type { MediaRehostDeps } from "../../src/services/mtproto/bot-clone/media-rehost.js";

function fakeRaw(chunks: Buffer[]): MediaRehostDeps["raw"] {
  return {
    iterDownload: () => ({
      [Symbol.asyncIterator]: async function* () {
        for (const c of chunks) yield c;
      },
    }),
  } as unknown as MediaRehostDeps["raw"];
}

function fakeSupabase(uploadError: { message: string } | null = null) {
  const uploadCalls: Array<{ bucket: string; key: string }> = [];
  const supabase = {
    storage: {
      listBuckets: vi.fn(async () => ({ data: [{ id: "media" }] })),
      createBucket: vi.fn(async () => ({})),
      from: (bucket: string) => ({
        upload: vi.fn(async (key: string) => {
          uploadCalls.push({ bucket, key });
          return { error: uploadError };
        }),
        getPublicUrl: (key: string) => ({
          data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${key}` },
        }),
      }),
    },
  };
  return { supabase: supabase as unknown as MediaRehostDeps["supabase"], uploadCalls };
}

const tmpDir = path.join(os.tmpdir(), "eaglebot-botclone-test");

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("downloadAndRehostMedia", () => {
  it("monta a key com tenantId/botclone/jobId/nodeId_fileName e devolve a URL pública", async () => {
    const raw = fakeRaw([Buffer.from("fake image bytes")]);
    const { supabase, uploadCalls } = fakeSupabase();

    const url = await downloadAndRehostMedia(
      { raw, supabase },
      {
        media: {},
        tenantId: "tenant1",
        jobId: "job1",
        nodeIdHint: "node1",
        fileName: "photo.jpg",
        tmpDir,
        maxBytes: 1024,
      },
    );

    expect(uploadCalls).toEqual([
      { bucket: "media", key: "tenant1/botclone/job1/node1_photo.jpg" },
    ]);
    expect(url).toBe(
      "https://fake.supabase.co/storage/v1/object/public/media/tenant1/botclone/job1/node1_photo.jpg",
    );
  });

  it("mídia maior que o teto: devolve null, sem chamar upload", async () => {
    const raw = fakeRaw([Buffer.alloc(2048, 1)]);
    const { supabase, uploadCalls } = fakeSupabase();

    const url = await downloadAndRehostMedia(
      { raw, supabase },
      {
        media: {},
        tenantId: "tenant1",
        jobId: "job1",
        nodeIdHint: "node1",
        fileName: "video.mp4",
        tmpDir,
        maxBytes: 1024,
      },
    );

    expect(url).toBeNull();
    expect(uploadCalls).toEqual([]);
  });

  it("erro no upload do Storage propaga (lança)", async () => {
    const raw = fakeRaw([Buffer.from("x")]);
    const { supabase } = fakeSupabase({ message: "bucket indisponível" });

    await expect(
      downloadAndRehostMedia(
        { raw, supabase },
        {
          media: {},
          tenantId: "tenant1",
          jobId: "job1",
          nodeIdHint: "node1",
          fileName: "a.jpg",
          tmpDir,
          maxBytes: 1024,
        },
      ),
    ).rejects.toThrow(/upload pro Storage falhou/);
  });

  it("cria o bucket 'media' se ele ainda não existir", async () => {
    const raw = fakeRaw([Buffer.from("x")]);
    const supabase = {
      storage: {
        listBuckets: vi.fn(async () => ({ data: [] })),
        createBucket: vi.fn(async () => ({})),
        from: () => ({
          upload: vi.fn(async () => ({ error: null })),
          getPublicUrl: () => ({ data: { publicUrl: "https://x" } }),
        }),
      },
    } as unknown as MediaRehostDeps["supabase"];

    await downloadAndRehostMedia(
      { raw, supabase },
      { media: {}, tenantId: "t", jobId: "j", nodeIdHint: "n", fileName: "a.jpg", tmpDir, maxBytes: 1024 },
    );

    expect(supabase.storage.createBucket).toHaveBeenCalledWith("media", { public: true });
  });
});
