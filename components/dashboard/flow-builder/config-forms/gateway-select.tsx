"use client";

import { GATEWAYS } from "@/lib/gateways";

/**
 * Seletor de gateway de um nó/botão de pagamento.
 *
 * "Padrão do bot" (valor vazio) é o default e mantém o comportamento de
 * sempre — a cobrança sai pelo gateway padrão configurado nas Configurações.
 * Escolher um gateway específico é o que permite montar "Pagar com PIX" e
 * "Pagar com cripto" como caminhos diferentes no mesmo fluxo.
 *
 * Só lista os gateways ATIVOS no bot. Se o nó aponta pra um gateway que foi
 * desativado depois, ele ainda aparece (marcado como inativo) pra a escolha
 * não sumir em silêncio da tela — em runtime o servidor cai no padrão e loga.
 */
export function GatewaySelect({
  value,
  onChange,
  enabledGateways,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  enabledGateways: string[];
  compact?: boolean;
}) {
  const options = GATEWAYS.filter(
    (g) => enabledGateways.includes(g.kind) || g.kind === value,
  );
  const staleChoice = Boolean(value) && !enabledGateways.includes(value);

  return (
    <div>
      <label className="input-label">Gateway</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={compact ? "input py-2! text-xs!" : "input"}
      >
        <option value="">Padrão do bot</option>
        {options.map((g) => (
          <option key={g.kind} value={g.kind}>
            {g.label}
            {enabledGateways.includes(g.kind) ? "" : " (inativo)"}
          </option>
        ))}
      </select>
      {staleChoice && (
        <p className="text-(--amber) text-[0.6875rem] leading-snug mt-1">
          Esse gateway não está ativo nas Configurações do bot — a cobrança vai
          sair pelo gateway padrão.
        </p>
      )}
    </div>
  );
}
