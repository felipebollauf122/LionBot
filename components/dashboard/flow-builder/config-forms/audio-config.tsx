"use client";

import { useEffect, useRef, useState } from "react";
import { MediaUpload } from "./media-upload";

interface AudioConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

/** Teto igual ao do engine (server/src/engine/nodes/audio.ts): o worker fica
 *  parado durante a simulação, então a UI não oferece mais do que ele aceita. */
const MAX_RECORDING_SECONDS = 8;

export function AudioConfig({ data, onChange }: AudioConfigProps) {
  const url = String(data.audio_url ?? "");
  const simulate = data.simulate_recording !== false;
  const seconds = Number(data.recording_seconds ?? 2);
  // Guarda a URL que falhou (em vez de um boolean + reset no efeito): o aviso
  // sai sozinho quando o usuário troca o arquivo, sem setState no corpo do
  // efeito nem render em cascata.
  const [probeErrorUrl, setProbeErrorUrl] = useState<string | null>(null);
  const probeError = probeErrorUrl !== null && probeErrorUrl === url;

  // onChange sempre-atual: a duração chega assíncrona (metadata do arquivo) e
  // não pode escrever por cima de edições feitas no nó nesse meio-tempo —
  // mesmo cuidado que MediaUpload toma com o upload demorado.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Duração lida do próprio arquivo: sem ela o Telegram mostra 0:00 na bolha
  // de voz até o cliente terminar de baixar o áudio.
  useEffect(() => {
    if (!url.trim()) return;
    const el = new Audio();
    el.preload = "metadata";
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        onChangeRef.current({ duration: Math.round(el.duration) });
      }
    };
    // Falha aqui é só cosmética (perde a duração na bolha) — o envio segue.
    const onError = () => setProbeErrorUrl(url);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("error", onError);
    el.src = url;
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("error", onError);
      el.src = "";
    };
  }, [url]);

  const duration = Number(data.duration ?? 0);

  return (
    <div className="space-y-3">
      <MediaUpload
        value={url}
        // PATCH só do campo alterado (mesmo motivo do nó de vídeo): o merge do
        // editor preserva o resto do data quando um upload longo termina.
        onChange={(next) => onChange({ audio_url: next, duration: 0 })}
        accept="audio/mpeg,audio/ogg,audio/mp4,audio/x-m4a,.mp3,.ogg,.oga,.m4a"
        label="Áudio"
        placeholder="https://... ou envie do computador"
      />

      {url && (
        <div className="space-y-1.5">
          {/* Prévia: dá pra conferir aqui mesmo o áudio que o lead vai receber. */}
          <audio controls src={url} className="w-full h-9" />
          {duration > 0 && (
            <p className="text-(--text-secondary) text-[0.6875rem]">
              Duração detectada: {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}
            </p>
          )}
          {probeError && (
            <p className="text-(--amber) text-[0.6875rem] leading-snug">
              Não consegui ler o arquivo pra detectar a duração. O envio funciona igual — só a
              duração na bolha pode aparecer zerada até o lead baixar o áudio.
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="input-label mb-0!">Simular gravação</label>
          <button
            type="button"
            onClick={() => onChange({ ...data, simulate_recording: !simulate })}
            className={`toggle-btn ${simulate ? "on" : "off"}`}
          >
            {simulate ? "Ativado" : "Desativado"}
          </button>
        </div>
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug">
          Mostra “gravando áudio…” no topo do chat antes de mandar, como se você estivesse
          gravando na hora.
        </p>
      </div>

      {simulate && (
        <div>
          <label className="input-label">Tempo de &quot;gravando&quot; (segundos)</label>
          <input
            type="number"
            min={1}
            max={MAX_RECORDING_SECONDS}
            value={Number.isFinite(seconds) && seconds > 0 ? seconds : 2}
            onChange={(e) => {
              const raw = Number(e.target.value);
              const clamped = Math.min(Math.max(Number.isFinite(raw) ? raw : 2, 1), MAX_RECORDING_SECONDS);
              onChange({ ...data, recording_seconds: clamped });
            }}
            className="input"
          />
          <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-2">
            Máximo {MAX_RECORDING_SECONDS}s — o fluxo fica parado nesse tempo.
          </p>
        </div>
      )}

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
        className="rounded-xl p-3 text-[11px] leading-snug"
        style={{
          background: "linear-gradient(135deg, color-mix(in srgb, var(--cyan) 6%, transparent), color-mix(in srgb, var(--cyan) 2%, transparent))",
          border: "1px solid color-mix(in srgb, var(--cyan) 10%, transparent)",
          color: "var(--cyan)",
        }}
      >
        Chega como <strong>mensagem de voz</strong> (bolha com onda e play), não como arquivo
        anexado. Formatos aceitos pelo Telegram: MP3, M4A e OGG/OPUS. Máximo 50MB.
      </div>
    </div>
  );
}
