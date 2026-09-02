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

/** O que cada tipo de mensagem aceita. Álbum é foto e vídeo — áudio tem tipo próprio. */
const ACEITA: Record<MessageKind, string> = {
  text: "image/*,video/*",
  photo: "image/*",
  video: "video/*",
  audio: "audio/*",
  album: "image/*,video/*",
};

const ROTULO: Record<MessageKind, string> = {
  text: "mídia",
  photo: "foto",
  video: "vídeo",
  audio: "áudio",
  album: "foto ou vídeo",
};

/** Um item de álbum nunca pode ser áudio; os outros tipos exigem correspondência exata. */
function tipoPermitido(tipo: MediaItem["type"], kind: MessageKind): boolean {
  if (kind === "album" || kind === "text") return tipo !== "audio";
  return tipo === kind;
}

/**
 * Tipo de uma URL colada. Para álbum não dá pra saber pelo MIME, então deduz
 * pela extensão — foto é o padrão, que é o caso comum.
 */
function tipoDaUrl(url: string, kind: MessageKind): MediaItem["type"] {
  if (kind === "photo" || kind === "video" || kind === "audio") return kind;
  return /\.(mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(url) ? "video" : "photo";
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

    // Arrastar-e-soltar ignora `multiple` e `accept` do input, então o corte
    // acontece aqui: sem isso, soltar 5 arquivos no modo foto subiria os 5 pro
    // Storage e descartaria 4.
    const lista = multiplo ? Array.from(files) : Array.from(files).slice(0, 1);

    const novos: MediaItem[] = [];
    const falhas: string[] = [];

    try {
      for (const file of lista) {
        const tipo = tipoDoArquivo(file);
        if (!tipo || !tipoPermitido(tipo, kind)) {
          falhas.push(`${file.name}: não é ${ROTULO[kind]}`);
          continue;
        }

        try {
          const fd = new FormData();
          fd.append("file", file);
          const { url: enviado } = await uploadMedia(fd);
          novos.push({ url: enviado, type: tipo });
        } catch (e) {
          // try/catch POR ARQUIVO: o que já subiu está no Storage de verdade, e
          // descartar por causa de um erro posterior deixaria arquivo órfão.
          falhas.push(`${file.name}: ${e instanceof Error ? e.message : "falha no upload"}`);
        }
      }

      if (novos.length > 0) onChange(multiplo ? [...media, ...novos] : [novos[0]]);
      if (falhas.length > 0) setErro(falhas.join(" · "));
    } finally {
      // `finally`, não `catch`: se o onChange do pai lançar, o spinner e o input
      // precisam voltar ao normal do mesmo jeito. Sem isto a tela fica presa em
      // "Enviando…" e reescolher o mesmo arquivo não dispara nada.
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function adicionarUrl() {
    const limpa = url.trim();
    if (limpa === "") return;
    const tipo = tipoDaUrl(limpa, kind);
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
            {enviando ? "Enviando…" : `Arraste ${ROTULO[kind]} aqui`}
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
            accept={ACEITA[kind]}
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
