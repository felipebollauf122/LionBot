"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_META, handleStyle } from "../flow-utils";
import { BaseNode } from "./base-node";

const COLOR = NODE_META.audio.color;
const BAR_COUNT = 26;

/**
 * Onda derivada da própria URL: cada áudio ganha um desenho próprio e estável
 * entre renders (Math.random faria a onda "tremer" a cada re-render do canvas).
 * FNV-1a pra semente + xorshift pras alturas.
 */
function waveform(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Array.from({ length: BAR_COUNT }, () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h |= 0;
    return 4 + (Math.abs(h) % 13); // 4px a 16px
  });
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Prévia do que o lead recebe: uma bolha de voz (play + onda + duração), não o
 * nome do arquivo — que no storage é um nanoid ilegível e não diz nada sobre o
 * áudio.
 */
export function AudioNode({ data, selected }: NodeProps) {
  const url = String(data.audio_url ?? "").trim();
  const caption = String(data.caption ?? "").trim();
  const duration = Number(data.duration ?? 0);
  const recording = data.simulate_recording !== false;
  const recordingSeconds = Number(data.recording_seconds ?? 2);
  const bars = waveform(url);

  return (
    <BaseNode type="audio" data={data} selected={selected} label="Áudio" className="min-w-52 max-w-70">
      <Handle type="target" position={Position.Top} style={handleStyle(COLOR)} />

      {url ? (
        <div
          className="flex items-center gap-2.5 rounded-xl px-2.5 py-2"
          style={{
            background: `color-mix(in srgb, ${COLOR} 7%, transparent)`,
            border: `1px solid color-mix(in srgb, ${COLOR} 12%, transparent)`,
          }}
        >
          {/* Botão de play: só ilustração da bolha, não toca nada aqui. */}
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${COLOR} 22%, transparent)` }}
            aria-hidden="true"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill={COLOR} style={{ marginLeft: 1 }}>
              <path d="M6 4l14 8-14 8z" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[2px] h-4" aria-hidden="true">
              {bars.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: h,
                    background: COLOR,
                    // Degradê de opacidade: a cabeça da onda parece "já tocada",
                    // igual à bolha do Telegram.
                    opacity: 0.3 + (i / BAR_COUNT) * 0.35,
                  }}
                />
              ))}
            </div>
            <p className="text-[0.625rem] mt-1 tabular-nums" style={{ color: COLOR, opacity: 0.75 }}>
              {duration > 0 ? formatDuration(duration) : "mensagem de voz"}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-(--text-muted) text-sm italic">Sem áudio</p>
      )}

      {caption && (
        <p className="text-(--text-secondary) text-sm mt-1.5 min-w-0 truncate">{caption}</p>
      )}

      {recording && (
        <p className="text-[0.6875rem] mt-1.5 flex items-center gap-1" style={{ color: COLOR, opacity: 0.7 }}>
          <span className="w-1 h-1 rounded-full shrink-0" style={{ background: COLOR }} aria-hidden="true" />
          grava por {Number.isFinite(recordingSeconds) && recordingSeconds > 0 ? Math.round(recordingSeconds) : 2}s antes de enviar
        </p>
      )}

      <Handle type="source" position={Position.Bottom} style={handleStyle(COLOR)} />
    </BaseNode>
  );
}
