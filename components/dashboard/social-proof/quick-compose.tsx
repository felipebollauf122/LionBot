"use client";

import { useState } from "react";
import type { SenderKind } from "@/lib/social-proof/types";

/**
 * Barra de composição rápida sob a prévia: cria mensagem de texto sem abrir o
 * editor. É o caminho de quem só quer despejar várias falas em sequência.
 */
export function QuickCompose({
  senderKind,
  onSenderKindChange,
  onSend,
  disabled,
}: {
  senderKind: SenderKind;
  onSenderKindChange: (k: SenderKind) => void;
  onSend: (text: string) => Promise<boolean>;
  disabled: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    // Guarda local de reentrância. O `disabled` que vem do shell reflete o
    // `pending` do useTransition, e este caminho deixou de passar por
    // startTransition pra poder esperar o resultado — então `pending` não cobre
    // a janela do saveMessage. Sem esta guarda, dois Enter seguidos em rede
    // lenta gravam a mensagem duas vezes: o envio rápido nunca tem `id`, então
    // as duas chamadas caem no insert.
    if (disabled || enviando) return;

    const limpo = texto.trim();
    if (limpo === "") return;

    setEnviando(true);
    try {
      const ok = await onSend(limpo);
      // Só limpa quando deu certo: limpar antes de saber apagaria o texto do
      // tenant numa falha, sem ele ter como recuperar.
      if (ok) setTexto("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-(--border-subtle) p-3">
      <div className="flex items-center gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder="Digite sua mensagem..."
          className="flex-1 rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent)"
        />

        {/* Segmentado, nunca select */}
        <div className="flex rounded-lg border border-(--border-default) p-0.5">
          {(["owner", "member"] as SenderKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onSenderKindChange(k)}
              className={`rounded-md px-2.5 py-1 text-xs ${
                senderKind === k
                  ? "bg-(--accent) text-(--on-accent)"
                  : "text-(--text-secondary)"
              }`}
            >
              {k === "owner" ? "Dona" : "Membro"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={enviar}
          disabled={disabled || enviando}
          className="rounded-lg bg-(--accent) px-3 py-2 text-sm text-(--on-accent) disabled:opacity-50"
          aria-label="Enviar"
        >
          ➤
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-(--text-ghost)">
        Dica: selecione ou crie uma mensagem para editar seus detalhes.
      </p>
    </div>
  );
}
