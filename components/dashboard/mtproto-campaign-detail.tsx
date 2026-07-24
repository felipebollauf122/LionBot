"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { launchCampaign, pauseCampaign, deleteCampaign } from "@/app/dashboard/automations/actions";
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

export function MtprotoCampaignDetail({
  initialCampaign,
  campaignId,
}: {
  initialCampaign: Campaign;
  campaignId: string;
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [targets, setTargets] = useState<Target[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    async function load() {
      const [{ data: c }, { data: ts }] = await Promise.all([
        supabase.from("mtproto_campaigns").select("*").eq("id", campaignId).single(),
        supabase
          .from("mtproto_targets")
          .select("*")
          .eq("campaign_id", campaignId)
          .order("sent_at", { ascending: false, nullsFirst: false })
          .limit(200),
      ]);
      if (cancelled) return;
      if (c) setCampaign(c as Campaign);
      if (ts) setTargets(ts as Target[]);
    }
    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [campaignId]);

  const progress =
    campaign.total_targets > 0
      ? Math.round(
          ((campaign.sent_count + campaign.failed_count) / campaign.total_targets) * 100,
        )
      : 0;

  const badge = campaignBadge(campaign.status);

  return (
    <div className="space-y-6">
      {/* Status + ações */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        <div className="flex items-center gap-2">
          {(campaign.status === "draft" || campaign.status === "paused") && (
            <button
              onClick={() => startTransition(() => launchCampaign(campaignId))}
              className="btn-primary text-xs px-4 py-2"
            >
              {campaign.status === "paused" ? "Retomar" : "Disparar"}
            </button>
          )}
          {(campaign.status === "running" || campaign.status === "scheduled") && (
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
                  router.push("/dashboard/automations");
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
      <div className="grid grid-cols-3 gap-3">
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
          hint={campaign.failed_count > 0 ? "verifique os alvos" : "sem falhas"}
          accent="amber"
          icon={icons.bolt}
          revealIndex={2}
        />
        <KpiCard
          label="Total"
          value=""
          numericValue={campaign.total_targets}
          format="int"
          hint="alvos"
          accent="purple"
          icon={icons.users}
          revealIndex={3}
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
        <h2 className="text-(--text-secondary) text-sm font-semibold mb-2">
          Alvos ({targets.length})
        </h2>
        <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
          {targets.length === 0 ? (
            <div className="py-8 text-center text-(--text-ghost) text-xs">Nenhum alvo ainda.</div>
          ) : (
            targets.map((t) => (
              <div
                key={t.id}
                className="row-hover flex items-center justify-between gap-3 px-3 py-3 rounded-lg bg-white/[0.02] border border-(--border-subtle)"
              >
                <span className="text-(--text-secondary) text-sm truncate">{t.target_identifier}</span>
                <span
                  className={`text-xs shrink-0 ${
                    t.status === "sent"
                      ? "text-(--cyan)"
                      : t.status === "failed"
                        ? "text-(--red)"
                        : "text-(--text-muted)"
                  }`}
                >
                  {t.status}
                  {t.error_message ? ` · ${t.error_message}` : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
