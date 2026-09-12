"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { automationHref } from "@/lib/automations/navigation";
import { createClient } from "@/lib/supabase/client";
import { launchCampaign, pauseCampaign, deleteCampaign } from "@/app/dashboard/automations/actions";
import { friendlyCampaignError, targetStatusLabel } from "@/lib/mtproto/campaign-errors";
import { KpiCard } from "@/components/dashboard/analytics/kpi-card";
import { icons } from "@/components/dashboard/analytics/icons";

// Mapa canônico de status → badge (mesmo do mtproto-campaign-list.tsx):
// running=info/cyan, scheduled=purple, pending/paused=pending/âmbar,
// completed=active/magenta, draft=inactive/cinza, failed=error/vermelho.
function campaignBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case "running":
      return { cls: "badge-info", label: "Ativa" };
    case "scheduled":
      return { cls: "badge-purple", label: "Agendada" };
    case "pending":
      return { cls: "badge-pending", label: "Pendente" };
    case "completed":
      return { cls: "badge-active", label: "Concluída" };
    case "paused":
      return { cls: "badge-pending", label: "Pausada" };
    case "draft":
      return { cls: "badge-inactive", label: "Rascunho" };
    case "failed":
      return { cls: "badge-error", label: "Falhou" };
    default:
      return { cls: "badge-inactive", label: status };
  }
}

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
}

interface Target {
  id: string;
  target_identifier: string;
  target_type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
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
  const [deleting, setDeleting] = useState(false);
  /** Recusa de disparar/retomar (fila interna fora do ar, env faltando). */
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const emAndamento = campaign.status === "running" || campaign.status === "scheduled";

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    async function load() {
      const { data: c } = await supabase
        .from("mtproto_campaigns")
        .select("*")
        .eq("id", campaignId)
        .single();
      const todos: Target[] = [];
      for (let from = 0; ; from += PAGINA) {
        const { data: pagina } = await supabase
          .from("mtproto_targets")
          .select("id, target_identifier, target_type, status, error_message, sent_at")
          .eq("campaign_id", campaignId)
          .order("sent_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, from + PAGINA - 1);
        if (!pagina || pagina.length === 0) break;
        todos.push(...(pagina as Target[]));
        if (pagina.length < PAGINA) break;
      }
      if (cancelled) return;
      if (c) setCampaign(c as Campaign);
      setTargets(todos);
    }
    load();
    // Em andamento a tela acompanha quase ao vivo; parada, só confere de vez
    // em quando (a lista inteira vem a cada rodada).
    const interval = setInterval(load, emAndamento ? 5000 : 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [campaignId, emAndamento]);

  const skipped = campaign.skipped_count ?? 0;
  const progress =
    campaign.total_targets > 0
      ? Math.round(
          ((campaign.sent_count + campaign.failed_count) / campaign.total_targets) * 100,
        )
      : 0;

  const contagem = useMemo(() => {
    const c = { sent: 0, failed: 0, skipped: 0, pending: 0 };
    for (const t of targets) {
      if (t.status in c) c[t.status as keyof typeof c] += 1;
    }
    return c;
  }, [targets]);

  const visiveis = useMemo(() => {
    const lista = filtro === "todos" ? targets : targets.filter((t) => t.status === filtro);
    return [...lista].sort((a, b) => {
      const oa = ORDEM_STATUS[a.status] ?? 9;
      const ob = ORDEM_STATUS[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      if (a.sent_at && b.sent_at) return b.sent_at.localeCompare(a.sent_at);
      return a.target_identifier.localeCompare(b.target_identifier, "pt-BR");
    });
  }, [targets, filtro]);

  const badge = campaignBadge(campaign.status);

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
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        <div className="flex items-center gap-2">
          {(campaign.status === "draft" || campaign.status === "paused") && (
            <button
              onClick={() =>
                startTransition(async () => {
                  // Recusa da fila interna vem como dado: sem isto, o clique
                  // não fazia nada visível e a campanha seguia em rascunho.
                  const r = await launchCampaign(campaignId);
                  setErroAcao(r.ok ? null : r.error);
                })
              }
              className="btn-primary text-xs px-4 py-2"
            >
              {campaign.status === "paused" ? "Retomar" : "Disparar"}
            </button>
          )}
          {emAndamento && (
            <button
              onClick={() => startTransition(() => pauseCampaign(campaignId))}
              className="btn-ghost text-xs px-4 py-2"
            >
              Pausar
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

      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Enviadas"
          value=""
          numericValue={campaign.sent_count}
          format="int"
          hint={`de ${campaign.total_targets}`}
          accent="cyan"
          icon={icons.check}
          revealIndex={1}
        />
        <KpiCard
          label="Falhas"
          value=""
          numericValue={campaign.failed_count}
          format="int"
          hint={campaign.failed_count > 0 ? "erro no envio; veja a lista" : "sem falhas"}
          accent="amber"
          icon={icons.bolt}
          revealIndex={2}
        />
        <KpiCard
          label="Pulados"
          value=""
          numericValue={skipped}
          format="int"
          hint={skipped > 0 ? "destinos que não aceitam" : "nenhum destino bloqueado"}
          accent="purple"
          icon={icons.users}
          revealIndex={3}
        />
        <KpiCard
          label="Total"
          value=""
          numericValue={campaign.total_targets}
          format="int"
          hint="alvos que podem receber"
          accent="magenta"
          icon={icons.megaphone}
          revealIndex={4}
        />
      </div>

      {/* Progresso */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-(--text-muted)">Progresso</span>
          <span className="text-(--text-secondary)">{Math.min(100, progress)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            style={{
              width: `${Math.min(100, progress)}%`,
              background: "linear-gradient(90deg, var(--accent), var(--cyan))",
            }}
            className="h-full rounded-full"
          />
        </div>
        {skipped > 0 && (
          <p className="text-(--text-muted) text-xs mt-2 leading-relaxed">
            {skipped === 1 ? "1 destino foi pulado" : `${skipped} destinos foram pulados`} por não
            aceitar mensagem desta conta (canal sem permissão de admin, grupo onde a conta está
            silenciada ou banida, chat restrito). Eles não contam como falha nem entram no
            total, e não voltam nos próximos ciclos.
          </p>
        )}
      </div>

      {/* Mensagem */}
      <div>
        <h2 className="text-(--text-secondary) text-sm font-semibold mb-2">Mensagem</h2>
        <pre className="p-3 rounded-lg bg-white/[0.02] border border-(--border-subtle) text-(--text-secondary) text-sm whitespace-pre-wrap">
          {campaign.message_text}
        </pre>
      </div>

      {/* Alvos */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="text-(--text-secondary) text-sm font-semibold">
            Alvos ({targets.length})
          </h2>
          <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Filtrar alvos">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={filtro === chip.id}
                onClick={() => setFiltro(chip.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
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
        <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
          {visiveis.length === 0 ? (
            <div className="py-8 text-center text-(--text-ghost) text-xs">
              {targets.length === 0 ? "Nenhum alvo ainda." : "Nenhum alvo neste filtro."}
            </div>
          ) : (
            visiveis.map((t) => {
              const motivo = friendlyCampaignError(t.error_message);
              return (
                <div
                  key={t.id}
                  className="row-hover px-3 py-2.5 rounded-lg bg-white/[0.02] border border-(--border-subtle)"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-(--text-secondary) text-sm truncate">{t.target_identifier}</span>
                    <span className={`text-xs shrink-0 font-medium ${corStatus(t.status)}`}>
                      {targetStatusLabel(t.status)}
                    </span>
                  </div>
                  {motivo && (
                    <p className="text-(--text-muted) text-xs mt-1 leading-relaxed break-words">
                      {motivo}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
