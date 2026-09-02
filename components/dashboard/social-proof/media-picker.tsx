"use client";

import { useRef, useState } from "react";
import { uploadMedia } from "@/lib/actions/upload-actions";
import type { MediaItem, MessageKind } from "@/lib/social-proof/types";

/** Deduz o tipo do item a partir do MIME do arquivo escolhido. */
function tipoDoArquivo(file: File): MediaItem["type"] | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

/**
 * Seletor de mídia com os três caminhos do mockup: arrastar-e-soltar, escolher
 * arquivo, e colar URL.
 *
 * `uploadMedia` LANÇA em erro (é a função compartilhada com as configurações do
 * bot, escrita antes da regra de recusa-como-dado). Por isso o try/catch aqui —
 * sem ele, o erro sobe e a tela quebra em vez de mostrar a mensagem.
 */
export function MediaPicker({
  media,
  kind,
  onChange,
}: {
  media: MediaItem[];
  kind: MessageKind;
  onChange: (media: MediaItem[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [url, setUrl] = useState("");

  const multiplo = kind === "album";

  async function receber(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErro(null);
    setEnviando(true);

    try {
      const novos: MediaItem[] = [];
      for (const file of Array.from(files)) {
        const tipo = tipoDoArquivo(file);
        if (!tipo) {
          setErro(`Tipo não suportado: ${file.type || file.name}`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const { url: enviado } = await uploadMedia(fd);
        novos.push({ url: enviado, type: tipo });
      }
      if (novos.length > 0) onChange(multiplo ? [...media, ...novos] : [novos[0]]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no upload.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function adicionarUrl() {
    const limpa = url.trim();
    if (limpa === "") return;
    const tipo: MediaItem["type"] =
      kind === "audio" ? "audio" : kind === "video" ? "video" : "photo";
    onChange(multiplo ? [...media, { url: limpa, type: tipo }] : [{ url: limpa, type: tipo }]);
    setUrl("");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {media.map((item, i) => (
          <div key={`${item.url}-${i}`} className="relative">
            {item.type === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="" className="h-24 w-32 rounded-lg object-cover" />
            ) : (
              <div className="flex h-24 w-32 items-center justify-center rounded-lg bg-(--bg-input) text-xs text-(--text-muted)">
                {item.type === "video" ? "vídeo" : "áudio"}
              </div>
            )}
            <button
              type="button"
              onClick={() => onChange(media.filter((_, j) => j !== i))}
              className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-(--bg-overlay) text-(--text-primary)"
              aria-label="Remover mídia"
            >
              ×
            </button>
          </div>
        ))}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setSobre(true);
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSobre(false);
            void receber(e.dataTransfer.files);
          }}
          className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-xs ${
            sobre ? "border-(--accent) bg-(--accent-deep)" : "border-(--border-default)"
          }`}
        >
          <span className="text-(--text-muted)">
            {enviando ? "Enviando…" : "Arraste foto ou vídeo aqui"}
          </span>
          <span className="text-(--text-ghost)">ou</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="rounded-md border border-(--border-default) px-3 py-1.5 text-(--text-primary) disabled:opacity-50"
          >
            Escolher arquivo
          </button>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple={multiplo}
            accept="image/*,video/*,audio/*"
            onChange={(e) => void receber(e.target.files)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-(--text-muted)">ou usar URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionarUrl();
            }
          }}
          placeholder="https://..."
          className="flex-1 rounded-md bg-(--bg-input) border border-(--border-default) px-2 py-1 text-xs text-(--text-primary) outline-none focus:border-(--accent)"
        />
        <button
          type="button"
          onClick={adicionarUrl}
          className="rounded-md border border-(--border-default) px-2 py-1 text-xs text-(--text-primary)"
        >
          Adicionar
        </button>
      </div>

      {erro && <p className="text-xs text-(--red)">{erro}</p>}
    </div>
  );
}
