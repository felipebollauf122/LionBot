"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { nanoid } from "nanoid";

interface MediaUploadProps {
  value: string;
  onChange: (url: string) => void;
  accept: string;
  label: string;
  placeholder?: string;
}

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/quicktime",
  // Áudio (nó de voz): formatos que a Bot API aceita em sendVoice. audio/mp4 e
  // audio/x-m4a são o mesmo .m4a rotulado diferente por navegador/SO.
  "audio/mpeg", "audio/mp3", "audio/ogg", "audio/opus", "audio/mp4", "audio/x-m4a", "audio/m4a",
];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

export function MediaUpload({ value, onChange, accept, label, placeholder }: MediaUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref sempre-atual do onChange: um upload demorado concluía chamando o
  // onChange capturado no INÍCIO do upload — com o `data` velho no closure do
  // pai, apagando qualquer edição feita no nó enquanto o arquivo subia.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error(`Tipo de arquivo nao suportado: ${file.type}`);
      }
      if (file.size > MAX_SIZE) {
        throw new Error("Arquivo muito grande. Maximo 50MB.");
      }

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const ext = file.name.split(".").pop() ?? "bin";
      // Prefixo por usuário: exigido pela policy de DELETE do bucket 'media'
      // (002_storage_media.sql usa storage.foldername(name)[1] = auth.uid()) —
      // sem isso a policy nunca casava com nenhum upload real.
      const fileName = `${user?.id ?? "uploads"}/${nanoid()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(fileName, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw new Error(`Falha no upload: ${uploadError.message}`);

      const { data: urlData } = supabase.storage.from("media").getPublicUrl(fileName);
      onChangeRef.current(urlData.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="input-label">{label}</label>

      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "https://..."}
        className="input"
      />

      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full px-3 py-2.5 text-xs font-medium rounded-xl transition-all disabled:opacity-50"
        style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--cyan) 10%, transparent), color-mix(in srgb, var(--cyan) 4%, transparent))",
          border: "1px solid color-mix(in srgb, var(--cyan) 12%, transparent)",
          color: "var(--cyan)",
        }}
      >
        {uploading ? (
          <span className="flex items-center justify-center gap-2">
            <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            Enviando...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Enviar do computador
          </span>
        )}
      </button>

      {error && (
        <p className="text-(--red) text-[0.6875rem] leading-snug font-medium">{error}</p>
      )}

      {value && (
        <p className="text-(--accent) text-[0.6875rem] leading-snug truncate flex items-center gap-1.5">
          <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
          {value.split("/").pop()}
        </p>
      )}
    </div>
  );
}
