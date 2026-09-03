"use client";

import { useState } from "react";
import type { SenderKind } from "@/lib/social-proof/types";

import { motion, AnimatePresence } from "motion/react";

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
    if (disabled || enviando) return;

    const limpo = texto.trim();
    if (limpo === "") return;

    setEnviando(true);
    try {
      const ok = await onSend(limpo);
      if (ok) setTexto("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-3 w-full max-w-[380px] rounded-xl border border-(--border-subtle) p-3 bg-(--bg-overlay)">
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
          className="flex-1 min-w-0 rounded-lg bg-(--bg-input) border border-(--border-default) px-3 py-2 text-sm text-(--text-primary) outline-none focus:border-(--accent) transition-colors"
        />

        <div className="relative flex rounded-lg border border-(--border-default) p-0.5 bg-(--bg-input)">
          {(["owner", "member"] as SenderKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onSenderKindChange(k)}
              className={`relative rounded-md px-2.5 py-1.5 text-xs font-medium z-10 transition-colors ${
                senderKind === k
                  ? "text-(--on-accent)"
                  : "text-(--text-secondary) hover:text-(--text-primary)"
              }`}
            >
              {senderKind === k && (
                <motion.div
                  layoutId="quickComposeSender"
                  className="absolute inset-0 rounded-md bg-(--accent) z-[-1]"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                />
              )}
              {k === "owner" ? "admin" : "Membro"}
            </button>
          ))}
        </div>

        <motion.button
          whileHover={{ scale: (disabled || enviando) ? 1 : 1.05 }}
          whileTap={{ scale: (disabled || enviando) ? 1 : 0.95 }}
          type="button"
          onClick={enviar}
          disabled={disabled || enviando}
          className="relative flex items-center justify-center rounded-lg bg-(--accent) w-9 h-9 text-(--on-accent) disabled:opacity-50 transition-opacity"
          aria-label="Enviar"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {enviando ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <svg className="h-4 w-4 animate-spin text-(--on-accent)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              </motion.div>
            ) : (
              <motion.div
                key="icon"
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
      <p className="mt-2 text-center text-xs text-(--text-ghost)">
        Dica: selecione ou crie uma mensagem para editar seus detalhes.
      </p>
    </div>
  );
}
