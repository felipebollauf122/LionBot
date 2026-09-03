"use client";

import { useId, useState } from "react";
import {
  AUTO_DELETE_MAX_SECONDS,
  AUTO_DELETE_UNITS,
  autoDeleteSeconds,
  formatAutoDelete,
  type AutoDeleteUnit,
} from "../flow-utils";

interface AutoDeleteConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

/** O poller de deleção roda a cada 30s — abaixo disso o tempo é aproximado. */
const IMPRECISE_BELOW_SECONDS = 60;

const UNIT_LABELS: Record<AutoDeleteUnit, string> = {
  seconds: "Segundos",
  minutes: "Minutos",
  hours: "Horas",
};

function readUnit(data: Record<string, unknown>): AutoDeleteUnit {
  const unit = String(data.auto_delete_unit ?? "");
  return unit in AUTO_DELETE_UNITS ? (unit as AutoDeleteUnit) : "seconds";
}

function readSeconds(data: Record<string, unknown>): number {
  const raw = data.auto_delete_seconds;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Auto-delete por bloco: apaga as mensagens que ESTE bloco enviou depois do
 * tempo escolhido. Sem isso configurado, vale a regra do fluxo (black flow ou
 * o auto-delete do remarketing).
 *
 * `auto_delete_seconds` é a fonte da verdade (a engine só lê ele);
 * `auto_delete_unit` existe só pra lembrar em que unidade o usuário digitou —
 * senão "2 horas" voltaria como "7200 segundos" ao reabrir o painel.
 */
export function AutoDeleteConfig({ data, onChange }: AutoDeleteConfigProps) {
  const seconds = readSeconds(data);
  const unit = readUnit(data);
  const amount = seconds / AUTO_DELETE_UNITS[unit];

  // Visibilidade da seção vive em estado local (mesmo padrão do "Variar texto"
  // no TextConfig): apagar o campo pra redigitar zera auto_delete_seconds por
  // um instante, e sem isso a seção se fecharia sozinha no meio da digitação.
  // Remonta a cada nó (key={node.id} no NodeConfigPanel), então não vaza.
  const [enabled, setEnabled] = useState(() => readSeconds(data) > 0);
  const amountId = useId();
  const unitId = useId();

  const apply = (nextAmount: number, nextUnit: AutoDeleteUnit) => {
    onChange({
      ...data,
      auto_delete_seconds: autoDeleteSeconds(nextAmount, nextUnit),
      auto_delete_unit: nextUnit,
    });
  };

  const toggle = () => {
    setEnabled(!enabled);
    if (enabled) {
      // Desligou: tira os campos do node.data em vez de zerar, pra o bloco
      // voltar a ser indistinguível de um que nunca teve auto-delete.
      const rest = { ...data };
      delete rest.auto_delete_seconds;
      delete rest.auto_delete_unit;
      onChange(rest);
      return;
    }
    apply(30, "seconds");
  };

  const maxForUnit = Math.floor(AUTO_DELETE_MAX_SECONDS / AUTO_DELETE_UNITS[unit]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="input-label mb-0!">Apagar mensagem automaticamente</label>
        <button
          type="button"
          onClick={toggle}
          className={`toggle-btn ${enabled ? "on" : "off"}`}
        >
          {enabled ? "Ativado" : "Desativado"}
        </button>
      </div>

      {!enabled && (
        <p className="text-(--text-secondary) text-[0.6875rem] leading-snug">
          O bot apaga as mensagens deste bloco depois do tempo que você escolher.
        </p>
      )}

      {enabled && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="input-label" htmlFor={amountId}>Duração</label>
              <input
                id={amountId}
                type="number"
                min={1}
                max={maxForUnit}
                value={amount}
                onChange={(e) => apply(parseInt(e.target.value, 10) || 0, unit)}
                className="input"
              />
            </div>
            <div className="flex-1">
              <label className="input-label" htmlFor={unitId}>Unidade</label>
              <select
                id={unitId}
                value={unit}
                onChange={(e) => apply(amount, e.target.value as AutoDeleteUnit)}
                className="input"
              >
                {(Object.keys(UNIT_LABELS) as AutoDeleteUnit[]).map((u) => (
                  <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-(--text-secondary) text-[0.6875rem] leading-snug">
            {seconds > 0 ? (
              <>
                Apagada <span className="stat-value">{formatAutoDelete(seconds)}</span> depois do envio.
                {seconds < IMPRECISE_BELOW_SECONDS && " Precisão de ~30s (a fila de deleção é checada periodicamente)."}
                {" "}Sobrepõe o auto-delete do fluxo neste bloco.
              </>
            ) : (
              "Informe uma duração — com o campo vazio o bloco não apaga nada."
            )}
          </p>
        </div>
      )}
    </div>
  );
}
