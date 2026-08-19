"use client";

import { useRef, useState } from "react";

interface TextConfigProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  canRandomize?: boolean;
}

interface FormatButton {
  label: string;
  tag: string;
  title: string;
}

const FORMAT_BUTTONS: FormatButton[] = [
  { label: "B", tag: "b", title: "Negrito" },
  { label: "I", tag: "i", title: "Itálico" },
  { label: "U", tag: "u", title: "Sublinhado" },
  { label: "S", tag: "s", title: "Riscado" },
  { label: "</>", tag: "code", title: "Destaque (fundo)" },
  { label: "▒", tag: "tg-spoiler", title: "Spoiler (clica pra revelar)" },
];

export function TextConfig({ data, onChange, canRandomize = false }: TextConfigProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Estado local: controla se a seção de variações fica visível. Derivado do
  // valor inicial de text_variants, mas depois vive independente — assim dá
  // pra deixar a seção aberta enquanto o usuário monta a lista, mesmo que ela
  // fique momentaneamente vazia. O componente remonta (key={node.id} no
  // NodeConfigPanel) sempre que troca de nó, então esse estado não vaza entre nós.
  const [variantsEnabled, setVariantsEnabled] = useState(
    () => Array.isArray(data.text_variants) && (data.text_variants as string[]).length > 0,
  );

  const textVariants: string[] = Array.isArray(data.text_variants) ? (data.text_variants as string[]) : [];

  const setVariants = (next: string[]) => onChange({ ...data, text_variants: next });
  const updateVariant = (i: number, value: string) => {
    setVariants(textVariants.map((v, idx) => (idx === i ? value : v)));
  };
  const addVariant = () => setVariants([...textVariants, ""]);
  const removeVariant = (i: number) => setVariants(textVariants.filter((_, idx) => idx !== i));

  const toggleVariants = () => {
    const next = !variantsEnabled;
    setVariantsEnabled(next);
    if (!next) {
      // Desligou: limpa text_variants pra engine cair de volta no texto fixo
      // (data.text) em vez de continuar aplicando variações antigas por baixo dos panos.
      setVariants([]);
    } else if (textVariants.length === 0) {
      addVariant();
    }
  };

  function wrapSelection(tag: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const value = String(data.text ?? "");
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) {
      // Sem seleção: insere as duas tags com cursor no meio
      const next = `${value.slice(0, start)}<${tag}></${tag}>${value.slice(end)}`;
      onChange({ ...data, text: next });
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + tag.length + 2;
        ta.setSelectionRange(pos, pos);
      });
      return;
    }
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}<${tag}>${selected}</${tag}>${value.slice(end)}`;
    onChange({ ...data, text: next });
    requestAnimationFrame(() => {
      ta.focus();
      const newEnd = end + tag.length * 2 + 5;
      ta.setSelectionRange(start, newEnd);
    });
  }

  return (
    <div className="space-y-3">
      {/* Variar texto — toggle de acesso Premium */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="input-label mb-0!">Variar texto</label>
          <button
            type="button"
            disabled={!canRandomize}
            onClick={toggleVariants}
            className={`toggle-btn ${variantsEnabled ? "on" : "off"} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {variantsEnabled ? "Ativado" : "Desativado"}
          </button>
        </div>
        {!canRandomize && (
          <p className="text-(--text-muted) text-[10px]" style={{ opacity: 0.7 }}>
            Recurso Premium — disponível pra donos ou assinantes Premium.
          </p>
        )}
        {canRandomize && (
          <p className="text-(--text-muted) text-[10px]" style={{ opacity: 0.7 }}>
            Sorteia um texto entre as variações abaixo a cada envio.
          </p>
        )}
      </div>

      {variantsEnabled && canRandomize && (
        <div
          className="rounded-xl p-3 space-y-2"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border-subtle)" }}
        >
          <label className="input-label mb-0!">Variações</label>
          <div className="space-y-1.5">
            {textVariants.map((variant, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <textarea
                  value={variant}
                  onChange={(e) => updateVariant(i, e.target.value)}
                  rows={3}
                  placeholder="Texto da variação"
                  className="input resize-none font-mono text-xs flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeVariant(i)}
                  aria-label="Remover variação"
                  className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-(--text-muted) hover:text-(--red) hover:bg-(--red)/10 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addVariant}
            className="w-full text-xs py-2 rounded-lg border border-dashed border-(--border-default) text-(--text-secondary) hover:text-foreground hover:bg-white/[0.03] transition-colors flex items-center justify-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Adicionar variação
          </button>
        </div>
      )}

      <div>
        <label className="input-label">
          {variantsEnabled && canRandomize ? "Mensagem padrão (fallback)" : "Mensagem"}
        </label>
        <div className="flex flex-wrap gap-1 mb-2">
          {FORMAT_BUTTONS.map((btn) => (
            <button
              key={btn.tag}
              type="button"
              onClick={() => wrapSelection(btn.tag)}
              title={btn.title}
              className="px-2 py-1 text-xs rounded border border-white/10 bg-white/5 hover:bg-white/10 text-white/80 font-mono"
            >
              {btn.label}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={String(data.text ?? "")}
          onChange={(e) => onChange({ ...data, text: e.target.value })}
          rows={5}
          placeholder="Use {{first_name}} para variaveis"
          className="input resize-none font-mono text-sm"
        />
        <p className="text-(--text-muted) text-[10px] mt-2">
          {variantsEnabled && canRandomize
            ? "Usada quando nenhuma variação estiver definida (ou como texto único se a lista de variações ficar vazia). "
            : ""}
          Selecione o texto e clique no botão pra formatar. Suporte: negrito, itálico, sublinhado, riscado, destaque (fundo) e spoiler.
          Variáveis: {`{{first_name}}`}, {`{{username}}`}, ou variáveis do estado.
        </p>
      </div>
    </div>
  );
}
