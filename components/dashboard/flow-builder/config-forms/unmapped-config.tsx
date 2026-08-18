"use client";

interface UnmappedConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const KIND_EXPLANATION: Record<string, string> = {
  skipped_branch: "Este botao existia no bot original mas nao foi clicado durante a clonagem — o filtro de seguranca identificou risco de pagamento ou um tipo de botao sem representacao segura.",
  not_explored: "Este botao existia no bot original mas o job de clonagem terminou (limite de profundidade/nos, ou parou) antes de explora-lo.",
  unsupported_media: "O bot original enviou um tipo de midia que o EagleBot ainda nao sabe reproduzir automaticamente neste no.",
};

export function UnmappedConfig({ data }: UnmappedConfigProps) {
  const kind = String(data.kind ?? "unmapped");
  const skipReason = data.skip_reason ? String(data.skip_reason) : null;
  const originalLabel = data.original_label ? String(data.original_label) : null;
  const mediaKind = data.media_kind ? String(data.media_kind) : null;
  const mediaUrl = data.media_public_url ? String(data.media_public_url) : null;
  const caption = data.caption ? String(data.caption) : null;

  return (
    <div className="space-y-3">
      <div
        className="rounded-xl px-3 py-2.5 text-xs"
        style={{ background: "color-mix(in srgb, var(--amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--amber) 20%, transparent)", color: "var(--text-secondary)" }}
      >
        {KIND_EXPLANATION[kind] ?? "Conteudo gerado pela clonagem de bot que nao foi mapeado automaticamente."}
      </div>

      {originalLabel && (
        <div>
          <label className="input-label">Rotulo original do botao</label>
          <input type="text" value={originalLabel} readOnly disabled className="input opacity-70" />
        </div>
      )}
      {skipReason && (
        <div>
          <label className="input-label">Motivo</label>
          <input type="text" value={skipReason} readOnly disabled className="input opacity-70" />
        </div>
      )}
      {mediaKind && (
        <div>
          <label className="input-label">Tipo de midia original</label>
          <input type="text" value={mediaKind} readOnly disabled className="input opacity-70" />
        </div>
      )}
      {mediaUrl && (
        <div>
          <label className="input-label">Arquivo (re-hospedado)</label>
          <a href={mediaUrl} target="_blank" rel="noreferrer" className="text-(--cyan) text-xs break-all underline">{mediaUrl}</a>
        </div>
      )}
      {caption && (
        <div>
          <label className="input-label">Legenda original</label>
          <textarea value={caption} readOnly disabled rows={3} className="input opacity-70 resize-none" />
        </div>
      )}

      <p className="text-(--text-ghost) text-[11px]">
        Substitua este bloco por um no de verdade (texto, midia, botao, ou pagamento) antes de ativar este fluxo.
      </p>
    </div>
  );
}
