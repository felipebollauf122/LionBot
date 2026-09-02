"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";

function getStorageClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  const admin = getStorageClient();
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some((b) => b.id === "media")) {
    await admin.storage.createBucket("media", { public: true });
  }
  bucketReady = true;
}

export async function uploadMedia(formData: FormData): Promise<{ url: string }> {
  // Verify user is authenticated
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autorizado");

  const file = formData.get("file") as File | null;
  if (!file) throw new Error("Nenhum arquivo enviado");

  const allowedTypes = [
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm", "video/quicktime",
    "audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav",
  ];
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  }

  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error("Arquivo muito grande. Máximo 50MB.");
  }

  await ensureBucket();

  const ext = file.name.split(".").pop() ?? "bin";
  const fileName = `${user.id}/${nanoid()}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const admin = getStorageClient();
  const { error } = await admin.storage
    .from("media")
    .upload(fileName, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(`Falha no upload: ${error.message}`);
  }

  const { data: urlData } = admin.storage
    .from("media")
    .getPublicUrl(fileName);

  return { url: urlData.publicUrl };
}
