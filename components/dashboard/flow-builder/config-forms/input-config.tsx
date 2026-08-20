"use client";

interface InputConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function InputConfig({ data, onChange }: InputConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="input-label">Mensagem / Pergunta</label>
        <textarea
          value={String(data.prompt ?? "")}
          onChange={(e) => onChange({ ...data, prompt: e.target.value })}
          rows={3}
          placeholder="Qual seu email?"
          className="input resize-none"
        />
      </div>
      <div>
        <label className="input-label">Salvar em variavel</label>
        <input
          type="text"
          value={String(data.variable ?? "")}
          onChange={(e) => onChange({ ...data, variable: e.target.value })}
          placeholder="email"
          className="input"
        />
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-2">
          A resposta sera salva como <span className="text-(--purple) stat-value">{`{{${data.variable || "variavel"}}}`}</span>
        </p>
      </div>
    </div>
  );
}
