"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { automationHref } from "@/lib/automations/navigation";
import { createClient } from "@/lib/supabase/client";
import { launchCampaign, pauseCampaign, deleteCampaign, updateCampaign } from "@/app/dashboard/automations/actions";
import { friendlyCampaignError, targetStatusLabel } from "@/lib/mtproto/campaign-errors";
import { MtprotoCampaignProgress } from "@/components/dashboard/mtproto-campaign-progress";
import { campaignProgress } from "@/lib/mtproto/campaign-progress";

interface Campaign {
  id: string;
  name: string;
  message_text: string;
  status: string;
  total_targets: number;
  sent_count: number;
  failed_count: number;
  skipped_count?: number | null;
  delay_min_seconds: number;
  delay_max_seconds: number;
  started_at: string | null;
  completed_at: string | null;
  is_processing?: boolean;
  processing_started_at?: string | null;
  next_run_at?: string | null;
  recurrence_seconds?: number | null;
}

interface Target {
  id: string;
  target_identifier: string;
  target_type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  retry_after?: string | null;
}

type Filtro = "todos" | "sent" | "failed" | "skipped" | "pending";

// Ordem da lista: o que acabou de acontecer (enviadas, mais recente primeiro),
// depois o que precisa de olho (falhas), depois o que foi pulado, e por fim a
// fila. Um status só é "pior" que o anterior pra quem está acompanhando.
const ORDEM_STATUS: Record<string, number> = { sent: 0, failed: 1, skipped: 2, pending: 3 };

function corStatus(status: string): string {
  switch (status) {
    case "sent":
      return "text-(--cyan)";
    case "failed":
      return "text-(--red)";
    case "skipped":
      return "text-(--amber)";
    default:
      return "text-(--text-muted)";
  }
}

// PostgREST devolve no máximo 1000 linhas por request; a lista antiga parava em
// 200 e escrevia "Alvos (200)" numa campanha de 316 — parecia bug. Agora pagina
// até o fim e o cabeçalho conta o que existe de verdade.
const PAGINA = 1000;

export function MtprotoCampaignDetail({
  initialCampaign,
  campaignId,
}: {
  initialCampaign: Campaign;
  campaignId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [targets, setTargets] = useState<Target[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Recusa de disparar/retomar (fila interna fora do ar, env faltando). */
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const actionVersion = useRef(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState({ name: "", message: "", delayMin: 0, delayMax: 0, recurrenceSeconds: null as number | null });

  const emAndamento = campaign.status === "running" || campaign.status === "scheduled";

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      const version = actionVersion.current;
      try {
        const { data: c, error } = await supabase.from("mtproto_campaigns").select("*").eq("id", campaignId).single();
        if (error || !c) throw error ?? new Error("Campanha não encontrada");
        const todos: Target[] = [];
        // Ordem estável durante envios; não exibir páginas parciais em caso de erro.
        for (let from = 0; !cancelled; from += PAGINA) {
          const { data: pagina, error: pageError } = await supabase.from("mtproto_targets")
            .select("id,target_identifier,target_type,status,error_message,sent_at,retry_after")
            .eq("campaign_id", campaignId).order("id").range(from, from + PAGINA - 1);
          if (pageError) throw pageError;
          todos.push(...(pagina ?? []));
          if (!pagina || pagina.length < PAGINA) break;
        }
        if (cancelled || version !== actionVersion.current) return;
        setCampaign(c); setTargets(todos); setLoaded(true); setLoadError(null);
      } catch {
        if (!cancelled) setLoadError("Não foi possível atualizar agora. Mantivemos os últimos dados e vamos tentar novamente.");
      } finally { loading = false; }
    }
    void load();
    // Em andamento a tela acompanha quase ao vivo; parada, só confere de vez
    // em quando (a lista inteira vem a cada rodada).
    const interval = setInterval(load, emAndamento ? 5000 : 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [campaignId, emAndamento]);

  const contagem = useMemo(() => {
    const c = { sent: 0, failed: 0, skipped: 0, pending: 0 };
    for (const t of targets) {
      if (t.status in c) c[t.status as keyof typeof c] += 1;
    }
    return c;
  }, [targets]);

  const visiveis = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const lista = targets.filter(t => (filtro === "todos" || t.status === filtro) && (!term || `${t.target_identifier} ${friendlyCampaignError(t.error_message) ?? ""}`.toLocaleLowerCase("pt-BR").includes(term)));
    return [...lista].sort((a, b) => {
      const oa = ORDEM_STATUS[a.status] ?? 9;
      const ob = ORDEM_STATUS[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      if (a.sent_at && b.sent_at) return b.sent_at.localeCompare(a.sent_at);
      return a.target_identifier.localeCompare(b.target_identifier, "pt-BR");
    });
  }, [targets, filtro, search]);

  const displayedCampaign = loaded ? { ...campaign, sent_count: contagem.sent, failed_count: contagem.failed, skipped_count: contagem.skipped, total_targets: contagem.sent + contagem.failed + contagem.pending } : campaign;
  const display = campaignProgress(displayedCampaign);
  const latestSent = targets.reduce<string | null>((last, t) => t.sent_at && (!last || t.sent_at > last) ? t.sent_at : last, null);
  const lastPage = Math.max(0, Math.ceil(visiveis.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);
  const reasons = new Map<string, number>();
  for (const target of targets) {
    if (!target.error_message || target.status === "sent") continue;
    const reason = friendlyCampaignError(target.error_message) ?? target.error_message;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const chips: Array<{ id: Filtro; label: string; n: number }> = [
    { id: "todos", label: "Todos", n: targets.length },
    { id: "sent", label: "Enviadas", n: contagem.sent },
    { id: "failed", label: "Falhas", n: contagem.failed },
    { id: "skipped", label: "Pulados", n: contagem.skipped },
    { id: "pending", label: "Aguardando", n: contagem.pending },
  ];

  return (
    <div className="space-y-6">
      {erroAcao && (
        <p role="alert" className="text-(--red) text-xs break-words">{erroAcao}</p>
      )}
      {/* Status + ações */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-base font-medium">{campaign.recurrence_seconds ? `Repete a cada ${campaign.recurrence_seconds}s` : "Um ciclo"}</p>
          <p className="text-sm text-(--text-secondary)">{campaign.delay_min_seconds === campaign.delay_max_seconds ? `${campaign.delay_min_seconds}s` : `${campaign.delay_min_seconds}–${campaign.delay_max_seconds}s`} entre mensagens · sem ciclos simultâneos</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending || editing} className="btn-ghost min-h-11 px-4 text-sm" onClick={() => {
            setDraft({ name: campaign.name, message: campaign.message_text, delayMin: campaign.delay_min_seconds, delayMax: campaign.delay_max_seconds, recurrenceSeconds: campaign.recurrence_seconds ?? null });
            setEditing(true); setSaved(false); setErroAcao(null);
          }}>Editar disparo</button>
          {(["draft", "paused", "failed"].includes(campaign.status)) && (
            <button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  // Recusa da fila interna vem como dado: sem isto, o clique
                  // não fazia nada visível e a campanha seguia em rascunho.
                  actionVersion.current += 1;
                  try {
                    const r = await launchCampaign(campaignId);
                    setErroAcao(r.ok ? null : r.error);
                    if (r.ok) setCampaign(c => ({ ...c, status: "running", is_processing: false }));
                  } catch { setErroAcao("Não foi possível retomar. Tente novamente."); }
                })
              }
              className="btn-primary text-xs px-4 py-2"
            >
              {campaign.status === "paused" ? "Retomar" : "Disparar"}
            </button>
          )}
          {emAndamento && (
            <button
              disabled={pending}
              onClick={() => startTransition(async () => {
                actionVersion.current += 1;
                try { await pauseCampaign(campaignId); setCampaign(c => ({ ...c, status: "paused" })); setErroAcao(null); }
                catch { setErroAcao("Não foi possível pausar. Tente novamente."); }
              })}
              className="btn-primary min-h-11 text-sm px-4 py-2 disabled:opacity-50"
            >
              Pausar envio
            </button>
          )}
          <button
            disabled={deleting}
            onClick={() => {
              if (!confirm(`Excluir a campanha "${campaign.name}"? Esta ação não pode ser desfeita.`)) return;
              setDeleting(true);
              startTransition(async () => {
                try {
                  await deleteCampaign(campaignId);
                  router.push(automationHref("/dashboard/automations/campaigns", searchParams.get("view")));
                  router.refresh();
                } catch (err) {
                  alert(err instanceof Error ? err.message : "erro ao excluir");
                  setDeleting(false);
                }
              });
            }}
            className="btn-danger text-xs px-4 py-2 disabled:opacity-50"
            title="Excluir campanha permanentemente"
          >
            {deleting ? "Excluindo..." : "Excluir"}
          </button>
        </div>
      </div>

      {saved && <p role="status" className="text-sm text-(--cyan)">Alterações salvas. Os próximos envios usarão a nova configuração.</p>}
      {editing && <form className="space-y-5 border-y border-(--border-default) py-6" onSubmit={e => {
        e.preventDefault(); setErroAcao(null);
        startTransition(async () => {
          actionVersion.current += 1;
          try {
            const result = await updateCampaign(campaignId, draft);
            actionVersion.current += 1;
            if (!result.ok) { setErroAcao(result.error); return; }
            setCampaign(c => ({ ...c, name: draft.name.trim(), message_text: draft.message, delay_min_seconds: draft.delayMin, delay_max_seconds: draft.delayMax, recurrence_seconds: draft.recurrenceSeconds }));
            setEditing(false); setSaved(true); router.refresh();
          } catch { setErroAcao("Não foi possível salvar. Suas alterações foram mantidas para tentar novamente."); }
        });
      }}>
        <div><h2 className="text-lg font-semibold">Editar disparo</h2><p className="mt-1 text-sm text-(--text-secondary)">Você pode editar enquanto o envio continua. Mensagens já enviadas não são alteradas.</p></div>
        <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
          <div><label htmlFor="edit-name" className="input-label">Nome do disparo</label><input id="edit-name" className="input w-full" required value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></div>
          <div><label htmlFor="edit-message" className="input-label">Mensagem</label><textarea id="edit-message" className="input w-full min-h-40" required rows={6} value={draft.message} onChange={e => setDraft(d => ({ ...d, message: e.target.value }))} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="edit-min" className="input-label">Intervalo mínimo entre mensagens (s)</label><input id="edit-min" className="input w-full" type="number" min={0} step={1} required value={draft.delayMin} onChange={e => setDraft(d => ({ ...d, delayMin: e.target.valueAsNumber }))} /></div>
            <div><label htmlFor="edit-max" className="input-label">Intervalo máximo entre mensagens (s)</label><input id="edit-max" className="input w-full" type="number" min={draft.delayMin} step={1} required value={draft.delayMax} onChange={e => setDraft(d => ({ ...d, delayMax: e.target.valueAsNumber }))} /></div>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.recurrenceSeconds !== null} onChange={e => setDraft(d => ({ ...d, recurrenceSeconds: e.target.checked ? campaign.recurrence_seconds ?? 60 : null }))} />Repetir até eu pausar</label>
          {draft.recurrenceSeconds !== null && <div><label htmlFor="edit-repeat" className="input-label">Repetir a cada (segundos)</label><input id="edit-repeat" className="input w-full sm:max-w-64" type="number" min={1} step={1} required value={draft.recurrenceSeconds} onChange={e => setDraft(d => ({ ...d, recurrenceSeconds: e.target.valueAsNumber }))} /><p className="mt-2 text-sm text-(--text-secondary)">Contado desde o início do ciclo. Se ele durar mais, o próximo começa assim que terminar.</p></div>}
          <div className="flex flex-wrap gap-3"><button className="btn-primary min-h-11" type="submit">{pending ? "Salvando…" : "Salvar alterações"}</button><button className="btn-ghost min-h-11" type="button" onClick={() => { setEditing(false); setErroAcao(null); }}>Cancelar</button></div>
        </fieldset>
      </form>}

      {loadError && <p role="status" className="text-sm text-(--amber)">{loadError}</p>}
      <MtprotoCampaignProgress campaign={displayedCampaign} latestSent={latestSent} />
      {reasons.size > 0 && <details className="border-b border-(--border-default) pb-5" open={campaign.status === "scheduled"}>
        <summary className="min-h-11 cursor-pointer text-base font-semibold">O que impediu o envio · {reasons.size} motivos</summary>
        <ul className="mt-3 grid gap-4 md:grid-cols-2">{[...reasons].sort((a, b) => b[1] - a[1]).map(([reason, count]) => <li key={reason} className="text-sm leading-relaxed text-(--text-secondary)"><strong className="mr-2 tabular-nums text-foreground">{count}</strong>{reason}</li>)}</ul>
      </details>}

      {/* Mensagem */}
      <details>
        <summary className="min-h-11 cursor-pointer text-base font-semibold">Mensagem do disparo</summary>
        <pre className="p-3 rounded-lg bg-white/[0.02] border border-(--border-subtle) text-(--text-secondary) text-sm whitespace-pre-wrap break-words">
          {campaign.message_text}
        </pre>
      </details>

      {/* Alvos */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="text-(--text-secondary) text-sm font-semibold">
            Destinos ({display.total.toLocaleString("pt-BR")})
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap" aria-label="Filtrar destinos">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                aria-pressed={filtro === chip.id}
                onClick={() => { setFiltro(chip.id); setPage(0); }}
                className={`min-h-11 text-sm px-3 py-2 rounded-lg border transition-colors ${
                  filtro === chip.id
                    ? "border-(--accent) text-foreground bg-white/[0.06]"
                    : "border-(--border-subtle) text-(--text-muted) hover:text-foreground"
                }`}
              >
                {chip.label} <span className="opacity-70">{chip.n}</span>
              </button>
            ))}
          </div>
        </div>
        <label htmlFor="campaign-search" className="sr-only">Buscar destino ou motivo</label>
        <input id="campaign-search" className="input mb-4 w-full" placeholder="Buscar destino ou motivo…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <div className="divide-y divide-(--border-subtle) border-y border-(--border-default)">
          {visiveis.length === 0 ? (
            <div className="py-8 text-center text-(--text-ghost) text-xs">
              {!loaded ? (loadError ? "Aguardando conexão para carregar destinos." : "Carregando destinos…") : "Nenhum destino encontrado neste filtro."}
            </div>
          ) : (
            visiveis.slice(currentPage * 50, (currentPage + 1) * 50).map((t) => {
              const motivo = friendlyCampaignError(t.error_message);
              return (
                <div
                  key={t.id}
                  className="px-1 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-(--text-secondary) text-sm min-w-0 break-all">{t.target_identifier}</span>
                    <span className={`text-xs shrink-0 font-medium ${corStatus(t.status)}`}>
                      {targetStatusLabel(t.status)}
                    </span>
                  </div>
                  {t.sent_at && <p className="mt-1 text-xs text-(--text-muted) tabular-nums">Enviado em {new Date(t.sent_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
                  {t.status === "pending" && t.retry_after && <p className="mt-1 text-xs text-(--text-muted) tabular-nums">Nova tentativa a partir de {new Date(t.retry_after).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
                  {motivo && (
                    <p className="text-(--text-muted) text-sm mt-1 leading-relaxed break-words">
                      {motivo}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-between items-center gap-3 text-sm text-(--text-secondary)"><span>Página {currentPage + 1} de {lastPage + 1} · {visiveis.length} resultados</span><div className="flex gap-2"><button className="btn-ghost min-h-11 disabled:opacity-40" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="btn-ghost min-h-11 disabled:opacity-40" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button></div></div>
      </div>
    </div>
  );
}
