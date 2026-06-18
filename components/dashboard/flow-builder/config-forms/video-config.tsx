"use client";

import { MediaUpload } from "./media-upload";

interface VideoConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function VideoConfig({ data, onChange }: VideoConfigProps) {
  return (
    <div className="space-y-3">
      <MediaUpload
        value={String(data.video_url ?? "")}
        onChange={(url) => onChange({ ...data, video_url: url })}
        accept="video/mp4,video/webm,video/quicktime"
        label="Video"
        placeholder="https://... ou envie do computador"
      />
      <div>
        <label className="input-label">Legenda (opcional)</label>
        <input
          type="text"
          value={String(data.caption ?? "")}
          onChange={(e) => onChange({ ...data, caption: e.target.value })}
          className="input"
        />
      </div>
      <div
        className="rounded-xl p-3 text-[11px]"
        style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--cyan) 6%, transparent), color-mix(in srgb, var(--cyan) 2%, transparent))",
          border: "1px solid color-mix(in srgb, var(--cyan) 10%, transparent)",
          color: "var(--cyan)",
          opacity: 0.7,
        }}
      >
        Formatos suportados: MP4, WebM. Maximo 50MB.
      </div>
    </div>
  );
}
