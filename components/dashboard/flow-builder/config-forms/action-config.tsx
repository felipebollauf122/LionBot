"use client";

interface ActionConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function ActionConfig({ data, onChange }: ActionConfigProps) {
  const actionType = String(data.action_type ?? "set_variable");

  return (
    <div className="space-y-3">
      <div>
        <label className="input-label">Tipo de Acao</label>
        <select
          value={actionType}
          onChange={(e) => onChange({ ...data, action_type: e.target.value })}
          className="input"
        >
          <option value="add_tag">Adicionar Tag</option>
          <option value="remove_tag">Remover Tag</option>
          <option value="set_variable">Definir Variavel</option>
          {/* start_flow/stop_flow são no-ops na engine (só add_tag/remove_tag/
              set_variable executam) — não são mais selecionáveis. Nó antigo
              que já tenha um desses valores mostra a option marcada como não
              suportada, pra não mentir no select. */}
          {actionType === "start_flow" && <option value="start_flow">Iniciar Fluxo (não suportado)</option>}
          {actionType === "stop_flow" && <option value="stop_flow">Parar Fluxo (não suportado)</option>}
        </select>
      </div>
      {(actionType === "add_tag" || actionType === "remove_tag") && (
        <div>
          <label className="input-label">Tag</label>
          <input
            type="text"
            value={String(data.tag ?? "")}
            onChange={(e) => onChange({ ...data, tag: e.target.value })}
            placeholder="comprador"
            className="input"
          />
        </div>
      )}
      {actionType === "set_variable" && (
        <>
          <div>
            <label className="input-label">Variavel</label>
            <input
              type="text"
              value={String(data.variable ?? "")}
              onChange={(e) => onChange({ ...data, variable: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="input-label">Valor</label>
            <input
              type="text"
              value={String(data.value ?? "")}
              onChange={(e) => onChange({ ...data, value: e.target.value })}
              className="input"
            />
          </div>
        </>
      )}
    </div>
  );
}
