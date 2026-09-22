import { campaignProgress, type CampaignProgressSource } from "@/lib/mtproto/campaign-progress";

export function MtprotoCampaignProgress({ campaign, latestSent }: { campaign: CampaignProgressSource; latestSent: string | null }) {
  const p = campaignProgress(campaign);
  const n = (v: number) => v.toLocaleString("pt-BR");
  const date = (v: string) => new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const metrics = [
    { label: "Enviados", value: campaign.sent_count, color: "text-(--cyan)" },
    { label: "Na fila", value: p.pending, color: "text-foreground" },
    { label: "Falhas", value: campaign.failed_count, color: "text-(--red)" },
    { label: "Pulados", value: p.skipped, color: "text-(--amber)" },
  ];
  return <section aria-label="Progresso do disparo" className="border-y border-(--border-default) py-6">
    <div className="flex flex-wrap justify-between gap-4">
      <div className="max-w-xl"><h2 className="text-xl font-semibold text-foreground">{p.label}</h2><p className="mt-2 text-sm leading-relaxed text-(--text-secondary)">{p.description}</p></div>
      <div className="text-sm text-(--text-secondary)"><p>Último envio</p><p className="mt-1 tabular-nums text-foreground">{latestSent ? date(latestSent) : "Ainda não houve envio"}</p><p className="mt-1 text-xs">Horário de Brasília</p></div>
    </div>
    {campaign.status === "scheduled" && campaign.next_run_at && <p className="mt-4 text-sm text-(--amber)">Próxima tentativa: <strong className="tabular-nums">{date(campaign.next_run_at)}</strong></p>}
    <dl className="my-6 grid grid-cols-2 gap-5 sm:grid-cols-4">{metrics.map(m => <div key={m.label}><dt className="text-sm text-(--text-secondary)">{m.label}</dt><dd className={`mt-1 text-3xl font-semibold tabular-nums ${m.color}`}>{n(m.value)}</dd></div>)}</dl>
    <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm text-(--text-secondary)"><span>{n(p.processed)} de {n(p.total)} destinos processados</span><span className="tabular-nums">{p.percent}%</span></div>
    <div role="progressbar" aria-label="Destinos processados" aria-valuemin={0} aria-valuemax={p.total || 1} aria-valuenow={p.processed} className="flex h-2 overflow-hidden rounded-full bg-(--bg-input)">
      {[{ value: campaign.sent_count, color: "bg-(--cyan)" }, { value: campaign.failed_count, color: "bg-(--red)" }, { value: p.skipped, color: "bg-(--amber)" }].map(s => <div key={s.color} className={s.color} style={{ width: `${p.total ? s.value / p.total * 100 : 0}%` }} />)}
    </div>
    <p className="mt-3 text-sm text-(--text-muted)">Total da lista: {n(p.total)} · Aptos: {n(campaign.total_targets)} · Pulados: {n(p.skipped)}. Pulados não contam como falha.</p>
  </section>;
}
