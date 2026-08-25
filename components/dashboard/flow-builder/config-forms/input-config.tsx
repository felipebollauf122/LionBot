"use client";

interface InputConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

/** Precisa bater com AnswerValidation em server/src/engine/nodes/input.ts. */
const VALIDATIONS = [
  { value: "any", label: "Qualquer texto" },
  { value: "email", label: "E-mail" },
  { value: "number", label: "Número" },
  { value: "phone", label: "Telefone" },
] as const;

export function InputConfig({ data, onChange }: InputConfigProps) {
  const validation = String(data.validation ?? "any");

  return (
    <div className="space-y-3">
      <div>
        <label className="input-label">Pergunta</label>
        <textarea
          value={String(data.prompt ?? "")}
          onChange={(e) => onChange({ ...data, prompt: e.target.value })}
          rows={3}
          placeholder="Qual seu email?"
          className="input resize-none"
        />
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-2">
          O bot manda essa mensagem e <strong>para o fluxo</strong> até o lead responder. Dá pra
          usar <span className="text-(--purple) stat-value">{"{{first_name}}"}</span> e outras
          variáveis já salvas.
        </p>
      </div>

      <div>
        <label className="input-label">Salvar em variavel (opcional)</label>
        <input
          type="text"
          value={String(data.variable ?? "")}
          onChange={(e) => onChange({ ...data, variable: e.target.value })}
          placeholder="email"
          className="input"
        />
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-2">
          {String(data.variable ?? "").trim() ? (
            <>
              A resposta sera salva como{" "}
              <span className="text-(--purple) stat-value">{`{{${data.variable}}}`}</span>
            </>
          ) : (
            <>Sem variável, a pergunta só segura o fluxo até o lead responder algo.</>
          )}
        </p>
      </div>

      <div>
        <label className="input-label">Formato aceito</label>
        <select
          value={validation}
          onChange={(e) => onChange({ ...data, validation: e.target.value })}
          className="input"
        >
          {VALIDATIONS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug mt-2">
          Resposta fora do formato não avança o fluxo: o bot repete o pedido e continua esperando.
        </p>
      </div>

      <div>
        <label className="input-label">Mensagem de erro (opcional)</label>
        <textarea
          value={String(data.retry_message ?? "")}
          onChange={(e) => onChange({ ...data, retry_message: e.target.value })}
          rows={2}
          placeholder="Deixe vazio pra usar a mensagem padrão"
          className="input resize-none"
        />
      </div>
    </div>
  );
}
