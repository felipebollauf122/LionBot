"use client";

interface TriggerConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function TriggerConfig({ data, onChange }: TriggerConfigProps) {
  const trigger = String(data.trigger ?? "command");

  // Gatilho de remarketing: ponto de entrada fixo, semeado por
  // createRemarketingFlow (lib/actions/remarketing-actions.ts) e nunca lido
  // pela engine (remarketing-worker.ts fixa trigger_type="remarketing" no
  // Flow sintético, ignorando node.data.trigger). Não faz sentido trocar —
  // mostrar como somente-leitura em vez de um <select> sem option
  // correspondente (que ficaria com nenhuma opção visualmente selecionada).
  if (trigger === "remarketing") {
    return (
      <div className="space-y-3">
        <div>
          <label className="input-label">Tipo de Gatilho</label>
          <div className="input flex items-center text-(--text-secondary) cursor-default select-none">
            Remarketing — ponto de entrada fixo
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="input-label">Tipo de Gatilho</label>
        <select
          value={trigger}
          onChange={(e) => onChange({ ...data, trigger: e.target.value })}
          className="input"
        >
          <option value="command">Comando</option>
          <option value="first_contact">Primeiro Contato</option>
        </select>
      </div>
      {trigger === "command" && (
        <div>
          <label className="input-label">Comando</label>
          <input
            type="text"
            value={String(data.command ?? "/start")}
            onChange={(e) => onChange({ ...data, command: e.target.value })}
            className="input"
          />
        </div>
      )}
    </div>
  );
}
