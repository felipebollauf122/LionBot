"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCloneJob, launchClone } from "@/app/dashboard/automations/clones/actions";

const TOGGLES = [
  { key: "copyReplies", label: "Respostas encadeadas", hint: "Mensagem que responde outra continua apontando para a cópia certa." },
  { key: "copyPins", label: "Mensagens fixadas", hint: "O que estava fixado na origem sai fixado no destino." },
  { key: "copyButtons", label: "Botões inline", hint: "Recria os botões de link. Força a rota lenta (baixar e reenviar)." },
  { key: "copyPolls", label: "Enquetes", hint: "Recria pergunta e opções. Os votos nascem zerados." },
] as const;

export function CloneForm({
  dialogId,
  sourceTitle,
}: {
  dialogId: string;
  sourceTitle: string;
}) {
  const router = useRouter();
  const [destTitle, setDestTitle] = useState(`${sourceTitle} (clone)`);
  const [copyIdentity, setCopyIdentity] = useState(true);
  const [limit, setLimit] = useState("");
  const [throttle, setThrottle] = useState("3000");
  const [flags, setFlags] = useState({
    copyReplies: false,
    copyPins: false,
    copyButtons: false,
    copyPolls: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-white/70 text-sm">Nome do destino</span>
        <input
          value={destTitle}
          onChange={(e) => setDestTitle(e.target.value)}
          className="mt-1 w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
        />
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={copyIdentity}
          onChange={(e) => setCopyIdentity(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="text-white text-sm">Copiar identidade da origem</span>
          <span className="block text-white/40 text-xs">
            Traz descrição e foto de perfil. O @username público não dá para copiar — o
            destino nasce privado, com link de convite.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-white/70 text-sm">Últimas N mensagens</span>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))}
            placeholder="vazio = tudo"
            className="mt-1 w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="text-white/70 text-sm">Pausa entre envios (ms)</span>
          <input
            value={throttle}
            onChange={(e) => setThrottle(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm text-white"
          />
        </label>
      </div>

      <div className="space-y-2">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={flags[t.key]}
              onChange={(e) => setFlags({ ...flags, [t.key]: e.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="text-white text-sm">{t.label}</span>
              <span className="block text-white/40 text-xs">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <button
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await createCloneJob({
              dialogId,
              destTitle,
              copyIdentity,
              messageLimit: limit ? Number(limit) : null,
              throttleMs: Math.max(500, Number(throttle) || 3000),
              ...flags,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            // launchClone lanca (throw) se o bot-server estiver fora do ar. O
            // job "draft" ja foi criado no banco, entao mesmo se isso falhar a
            // gente navega pra tela de progresso: la o usuario ve o status real
            // (inclusive last_error) e pode tentar "Retomar", em vez de travar
            // o formulario ou deixar o throw sem catch derrubar a pagina.
            try {
              await launchClone(res.cloneJobId);
            } catch {
              // Ignorado de proposito: a tela de progresso e quem reporta a falha.
            }
            router.push(`/dashboard/automations/clones/${res.cloneJobId}`);
          })
        }
        disabled={pending}
        className="px-4 py-2 rounded bg-(--accent) text-black text-sm font-medium disabled:opacity-50"
      >
        {pending ? "Criando..." : "Criar e começar a clonar"}
      </button>
    </div>
  );
}
