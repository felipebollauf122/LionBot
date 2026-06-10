"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { launchCampaign, pauseCampaign, deleteCampaign } from "@/app/dashboard/automations/actions";

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

  return (
    <div>
      <div className="flex items-center justify-between mt-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
          <p className="text-white/40 text-sm mt-1">
            {campaign.sent_count}/{campaign.total_targets} enviadas ·{" "}
            {campaign.failed_count} falhas · {campaign.status}
          </p>
        </div>
        {(campaign.status === "draft" || campaign.status === "paused") && (
          <button
            onClick={() => startTransition(() => launchCampaign(campaignId))}
            className="px-4 py-2 rounded bg-(--accent) text-black font-medium"
          >
            {campaign.status === "paused" ? "Retomar" : "Disparar"}
          </button>
        )}
        {(campaign.status === "running" || campaign.status === "scheduled") && (
          <button
            onClick={() => startTransition(() => pauseCampaign(campaignId))}
            className="px-4 py-2 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 font-medium"
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
          className="px-4 py-2 rounded border border-red-500/40 text-red-400 hover:bg-red-500/15 font-medium disabled:opacity-50"
          title="Excluir campanha permanentemente"
        >
          {deleting ? "Excluindo..." : "Excluir"}
        </button>
      </div>

      <div className="mt-6 w-full h-2 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-(--accent)" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-8">
        <h2 className="text-white/80 text-sm font-semibold mb-2">Mensagem</h2>
        <pre className="p-3 rounded bg-black/20 border border-white/10 text-white/80 text-sm whitespace-pre-wrap">
          {campaign.message_text}
        </pre>
      </div>

      <div className="mt-8">
        <h2 className="text-white/80 text-sm font-semibold mb-2">
          Alvos ({targets.length})
        </h2>
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {targets.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between p-2 rounded border border-white/5 text-sm"
            >
              <span className="text-white/80">{t.target_identifier}</span>
              <span
                className={`text-xs ${
                  t.status === "sent"
                    ? "text-(--cyan)"
                    : t.status === "failed"
                      ? "text-(--red)"
                      : "text-white/40"
                }`}
              >
                {t.status}
                {t.error_message ? ` · ${t.error_message}` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
