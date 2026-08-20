"use client";

import { MediaUpload } from "./media-upload";
import type { MediaAssetOption } from "../flow-editor";

interface ImageConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  mediaAssets?: MediaAssetOption[];
  canRandomize?: boolean;
}

export function ImageConfig({ data, onChange, mediaAssets = [], canRandomize = false }: ImageConfigProps) {
  const randomize = Boolean(data.randomize);
  const showRandomizeUI = randomize && canRandomize;
  const selectedIds = Array.isArray(data.media_asset_ids) ? (data.media_asset_ids as string[]) : [];
  const imageAssets = mediaAssets.filter((a) => a.kind === "image");

  const toggleAsset = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((assetId) => assetId !== id)
      : [...selectedIds, id];
    onChange({ ...data, media_asset_ids: next });
  };

  return (
    <div className="space-y-3">
      {/* Randomizar — toggle de acesso Premium */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="input-label mb-0!">Randomizar</label>
          <button
            type="button"
            disabled={!canRandomize}
            onClick={() => onChange({ ...data, randomize: !randomize })}
            className={`toggle-btn ${randomize ? "on" : "off"} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {randomize ? "Ativado" : "Desativado"}
          </button>
        </div>
        {!canRandomize && (
          <p className="text-(--text-secondary) text-[0.6875rem] leading-snug">
            Recurso Premium — disponível pra donos ou assinantes Premium.
          </p>
        )}
        {canRandomize && (
          <p className="text-(--text-secondary) text-[0.6875rem] leading-snug">
            Escolhe uma imagem aleatória da lista a cada envio, em vez de sempre a mesma.
          </p>
        )}
      </div>

      {showRandomizeUI ? (
        <div className="space-y-2">
          <label className="input-label">Imagens (uma é sorteada a cada envio)</label>
          {imageAssets.length === 0 ? (
            <p className="text-(--amber) text-[0.6875rem] leading-snug">
              Nenhuma imagem cadastrada. Cadastre mídias em <strong>Mídia</strong>, no menu do bot, pra usar aqui.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {imageAssets.map((asset) => {
                const checked = selectedIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleAsset(asset.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left transition-all"
                    style={{
                      background: checked ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "rgba(255,255,255,0.02)",
                      borderColor: checked ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border-subtle)",
                    }}
                  >
                    <span
                      className="w-4 h-4 shrink-0 rounded border flex items-center justify-center"
                      style={{
                        borderColor: checked ? "var(--accent)" : "var(--border-default)",
                        background: checked ? "var(--accent)" : "transparent",
                      }}
                    >
                      {checked && (
                        <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.url}
                      alt=""
                      className="w-8 h-8 rounded object-cover shrink-0"
                      style={{ border: "1px solid var(--border-subtle)" }}
                    />
                    <span className="text-xs text-(--text-secondary) truncate">
                      {asset.label || asset.url.split("/").pop()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <MediaUpload
          value={String(data.image_url ?? "")}
          // PATCH só do campo alterado: o merge do editor preserva o resto do
          // data — essencial na conclusão de upload demorado, que não pode
          // sobrescrever edições feitas no nó enquanto o arquivo subia.
          onChange={(url) => onChange({ image_url: url })}
          accept="image/jpeg,image/png,image/gif,image/webp"
          label="Imagem"
          placeholder="https://... ou envie do computador"
        />
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
    </div>
  );
}
