"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createEmptyCampaign } from "@/app/dashboard/automations/scheduled/actions";
import { automationHref } from "@/lib/automations/navigation";

export function NewScheduledCampaignForm({ actingTenantId, view }: { actingTenantId: string; view: string }) {
  const router = useRouter();
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="card max-w-2xl space-y-6 p-5 md:p-8" onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true;
      setError(null);
      start(async () => {
        try {
          const result = await createEmptyCampaign(actingTenantId, name);
          if (!result.ok) {
            setError(result.error);
            submitting.current = false;
            return;
          }
          router.push(automationHref(`/dashboard/automations/scheduled/${result.campaignId}`, view));
        } catch {
          setError("Não foi possível criar a campanha. Tente novamente.");
          submitting.current = false;
        }
      });
    }}>
      <div>
        <label htmlFor="campaign-name" className="input-label">Nome da campanha</label>
        <input id="campaign-name" className="input w-full" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="Ex.: Conteúdo da semana" autoComplete="off" disabled={pending} aria-describedby="campaign-name-hint" />
        <p id="campaign-name-hint" className="mt-2 text-sm text-(--text-secondary)">Na próxima tela, escolha o canal, adicione as mensagens e defina o agendamento.</p>
      </div>
      <p className="text-sm text-(--text-secondary)">A campanha começa como rascunho. A publicação só inicia quando você acionar Publicar.</p>
      {error && <p role="alert" className="text-sm text-(--red)">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending || !name.trim()}>{pending ? "Criando rascunho…" : "Criar rascunho"}</button>
        <Link href={automationHref("/dashboard/automations/scheduled/campaigns", view)} className="btn-ghost">Cancelar</Link>
      </div>
    </form>
  );
}
