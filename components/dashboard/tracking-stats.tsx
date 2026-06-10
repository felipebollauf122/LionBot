"use client";

import { useState, useTransition } from "react";
import { getTrackingEvents, getTrackingLeads } from "@/lib/actions/tracking-actions";
import type { TrackingEvent, Lead } from "@/lib/types/database";
import { CommandBar, KpiPill, FilterChip } from "@/components/dashboard/console/command-bar";
import { DataGrid, type Column } from "@/components/dashboard/console/data-grid";
import { ContextDrawer } from "@/components/dashboard/console/context-drawer";

interface TrackingStatsProps {
  botId: string;
  funnel: Record<string, number>;
  initialEvents: TrackingEvent[];
  initialLeads: Lead[];
  totalEvents: number;
  totalLeads: number;
  currentPage: number;
  pageSize: number;
}

const eventTypeLabels: Record<string, string> = {
  page_view: "Visualizacao",
  bot_start: "Entrou no Bot",
  view_offer: "Viu Oferta",
  checkout: "Checkout",
  purchase: "Compra",
};

const eventBadgeClass: Record<string, string> = {
  page_view: "badge-info",
  bot_start: "badge-info",
  view_offer: "badge-purple",
  checkout: "badge-pending",
  purchase: "badge-active",
};

const funnelAccent: Record<string, "magenta" | "cyan" | "purple" | "amber"> = {
  page_view: "cyan",
  bot_start: "cyan",
  view_offer: "purple",
  checkout: "amber",
  purchase: "magenta",
};

type Tab = "leads" | "events";

export function TrackingStats({
  botId, funnel, initialEvents, initialLeads,
  totalEvents, totalLeads, currentPage, pageSize,
}: TrackingStatsProps) {
  const [tab, setTab] = useState<Tab>("leads");
  const [events, setEvents] = useState(initialEvents);
  const [leads, setLeads] = useState(initialLeads);
  const [eventsPage, setEventsPage] = useState(currentPage);
  const [leadsPage, setLeadsPage] = useState(currentPage);
  const [eventsCount, setEventsCount] = useState(totalEvents);
  const [leadsCount, setLeadsCount] = useState(totalLeads);
  const [isPending, startTransition] = useTransition();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TrackingEvent | null>(null);

  const eventsTotalPages = Math.ceil(eventsCount / pageSize);
  const leadsTotalPages = Math.ceil(leadsCount / pageSize);

  const loadEventsPage = (newPage: number) => {
    startTransition(async () => {
      const result = await getTrackingEvents(botId, newPage);
      setEvents(result.events as TrackingEvent[]);
      setEventsCount(result.total);
      setEventsPage(newPage);
    });
  };

  const loadLeadsPage = (newPage: number) => {
    startTransition(async () => {
      const result = await getTrackingLeads(botId, newPage);
      setLeads(result.leads as Lead[]);
      setLeadsCount(result.total);
      setLeadsPage(newPage);
    });
  };

  const leadColumns: Column<Lead>[] = [
    {
      key: "name",
      header: "Lead",
      cell: (l) => (
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-[11px] font-bold stat-value" style={{ background: "color-mix(in srgb, var(--cyan) 14%, transparent)", color: "var(--cyan)" }}>
            {(l.first_name || "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-foreground font-medium truncate">{l.first_name || "—"}</p>
            <p className="text-[10px] text-(--text-ghost)">{l.username ? `@${l.username}` : "sem username"}</p>
          </div>
        </div>
      ),
    },
    { key: "tgid", header: "Telegram ID", secondary: true, cell: (l) => <span className="text-(--text-muted) text-xs font-mono stat-value">{l.telegram_user_id}</span> },
    { key: "source", header: "Fonte", secondary: true, cell: (l) => (l.utm_source ? <span className="badge badge-purple">{l.utm_source}</span> : <span className="text-(--text-ghost)">—</span>) },
    { key: "tid", header: "TID", secondary: true, cell: (l) => <span className="text-(--text-muted) text-xs font-mono stat-value">{l.tid ?? "—"}</span> },
    { key: "created", header: "Criado", align: "right", secondary: true, cell: (l) => <span className="text-(--text-muted) text-xs">{new Date(l.created_at).toLocaleDateString("pt-BR")}</span> },
  ];

  const eventColumns: Column<TrackingEvent>[] = [
    {
      key: "event",
      header: "Evento",
      cell: (e) => (
        <span className={`badge ${eventBadgeClass[e.event_type] ?? "badge-inactive"}`}>
          {eventTypeLabels[e.event_type] ?? e.event_type}
        </span>
      ),
    },
    { key: "tid", header: "TID", secondary: true, cell: (e) => <span className="text-(--text-muted) text-xs font-mono stat-value">{e.tid ?? "—"}</span> },
    {
      key: "source",
      header: "UTM Source",
      secondary: true,
      cell: (e) => {
        const utmSource = (e.utm_params as Record<string, string>)?.utm_source;
        return utmSource ? <span className="badge badge-purple">{utmSource}</span> : <span className="text-(--text-ghost)">—</span>;
      },
    },
    { key: "fbclid", header: "fbclid", secondary: true, cell: (e) => <span className="text-(--text-muted) text-xs font-mono">{e.fbclid ? e.fbclid.slice(0, 12) + "..." : "—"}</span> },
    {
      key: "fb",
      header: "FB",
      align: "center",
      cell: (e) => (e.sent_to_facebook ? <span className="text-(--accent) text-xs font-bold">OK</span> : <span className="text-(--text-ghost) text-xs">—</span>),
    },
    {
      key: "utmify",
      header: "Utmify",
      align: "center",
      cell: (e) => (e.sent_to_utmify ? <span className="text-(--accent) text-xs font-bold">OK</span> : <span className="text-(--text-ghost) text-xs">—</span>),
    },
    { key: "created", header: "Data", align: "right", secondary: true, cell: (e) => <span className="text-(--text-muted) text-xs">{new Date(e.created_at).toLocaleString("pt-BR")}</span> },
  ];

  const selectedEventUtm = selectedEvent ? (selectedEvent.utm_params as Record<string, string>) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <CommandBar
        title="Tracking"
        subtitle="funil de conversao"
        kpis={
          <>
            {Object.entries(eventTypeLabels).map(([key, label]) => (
              <KpiPill key={key} label={label} value={(funnel[key] ?? 0).toLocaleString("pt-BR")} accent={funnelAccent[key] ?? "magenta"} />
            ))}
          </>
        }
        filters={
          <>
            <FilterChip active={tab === "leads"} onClick={() => setTab("leads")} count={leadsCount}>Leads</FilterChip>
            <FilterChip active={tab === "events"} onClick={() => setTab("events")} count={eventsCount}>Eventos</FilterChip>
          </>
        }
      />

      <div className="flex-1 p-4 sm:p-6 pb-20 md:pb-6">
        {/* Mobile funnel KPIs (CommandBar hides KPIs below md) */}
        <div className="grid grid-cols-2 gap-2 mb-5 md:hidden">
          {Object.entries(eventTypeLabels).map(([key, label]) => (
            <KpiPill key={key} label={label} value={(funnel[key] ?? 0).toLocaleString("pt-BR")} accent={funnelAccent[key] ?? "magenta"} />
          ))}
        </div>

        {tab === "leads" ? (
          <>
            <div className="card overflow-x-auto">
              <DataGrid
                columns={leadColumns}
                rows={leads}
                rowKey={(l) => l.id}
                onRowClick={(l) => setSelectedLead(l)}
                selectedKey={selectedLead?.id ?? null}
                empty="Nenhum lead registrado"
              />
            </div>

            {leadsTotalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-5">
                <button onClick={() => loadLeadsPage(leadsPage - 1)} disabled={leadsPage <= 1 || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">Anterior</button>
                <span className="text-(--text-muted) text-sm stat-value px-3 py-1.5 rounded-lg bg-white/3">{leadsPage} / {leadsTotalPages}</span>
                <button onClick={() => loadLeadsPage(leadsPage + 1)} disabled={leadsPage >= leadsTotalPages || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">Proxima</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="card overflow-x-auto">
              <DataGrid
                columns={eventColumns}
                rows={events}
                rowKey={(e) => e.id}
                onRowClick={(e) => setSelectedEvent(e)}
                selectedKey={selectedEvent?.id ?? null}
                empty="Nenhum evento registrado"
              />
            </div>

            {eventsTotalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-5">
                <button onClick={() => loadEventsPage(eventsPage - 1)} disabled={eventsPage <= 1 || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">Anterior</button>
                <span className="text-(--text-muted) text-sm stat-value px-3 py-1.5 rounded-lg bg-white/3">{eventsPage} / {eventsTotalPages}</span>
                <button onClick={() => loadEventsPage(eventsPage + 1)} disabled={eventsPage >= eventsTotalPages || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">Proxima</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Lead detail drawer */}
      <ContextDrawer
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        title={selectedLead?.first_name || "Lead"}
        subtitle={selectedLead?.username ? `@${selectedLead.username}` : "detalhe do lead"}
      >
        {selectedLead && (
          <div className="space-y-4">
            <DetailRow label="Nome" value={selectedLead.first_name || "—"} />
            <DetailRow label="Username" value={selectedLead.username ? `@${selectedLead.username}` : "—"} />
            <DetailRow label="Telegram ID" value={String(selectedLead.telegram_user_id)} mono />
            <DetailRow label="TID" value={selectedLead.tid ?? "—"} mono />
            <DetailRow label="fbclid" value={selectedLead.fbclid ?? "—"} mono />
            <div className="divider my-2" />
            <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">Atribuição (UTM)</p>
            <DetailRow label="Source" value={selectedLead.utm_source ?? "—"} />
            <DetailRow label="Medium" value={selectedLead.utm_medium ?? "—"} />
            <DetailRow label="Campaign" value={selectedLead.utm_campaign ?? "—"} />
            <DetailRow label="Content" value={selectedLead.utm_content ?? "—"} />
            <DetailRow label="Term" value={selectedLead.utm_term ?? "—"} />
            <div className="divider my-2" />
            <DetailRow label="Criado em" value={new Date(selectedLead.created_at).toLocaleString("pt-BR")} />
          </div>
        )}
      </ContextDrawer>

      {/* Event detail drawer */}
      <ContextDrawer
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent ? (eventTypeLabels[selectedEvent.event_type] ?? selectedEvent.event_type) : "Evento"}
        subtitle="detalhe do evento"
      >
        {selectedEvent && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">Tipo</span>
              <span className={`badge ${eventBadgeClass[selectedEvent.event_type] ?? "badge-inactive"}`}>
                {eventTypeLabels[selectedEvent.event_type] ?? selectedEvent.event_type}
              </span>
            </div>
            <DetailRow label="TID" value={selectedEvent.tid ?? "—"} mono />
            <DetailRow label="fbclid" value={selectedEvent.fbclid ?? "—"} mono />
            <div className="divider my-2" />
            <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">Envio</p>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">Facebook</span>
              {selectedEvent.sent_to_facebook
                ? <span className="badge badge-active">Enviado</span>
                : <span className="badge badge-inactive">Pendente</span>}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">Utmify</span>
              {selectedEvent.sent_to_utmify
                ? <span className="badge badge-active">Enviado</span>
                : <span className="badge badge-inactive">Pendente</span>}
            </div>
            <div className="divider my-2" />
            <p className="text-[10px] uppercase tracking-[0.14em] text-(--text-ghost)">Parâmetros UTM</p>
            {selectedEventUtm && Object.keys(selectedEventUtm).length > 0 ? (
              Object.entries(selectedEventUtm).map(([k, v]) => (
                <DetailRow key={k} label={k} value={String(v)} mono />
              ))
            ) : (
              <p className="text-(--text-ghost) text-xs">Nenhum parâmetro UTM capturado.</p>
            )}
            <div className="divider my-2" />
            <DetailRow label="Criado em" value={new Date(selectedEvent.created_at).toLocaleString("pt-BR")} />
          </div>
        )}
      </ContextDrawer>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[11px] uppercase tracking-wider text-(--text-muted)">{label}</span>
      <span className={`text-sm text-foreground text-right truncate ${mono ? "font-mono stat-value text-xs" : ""}`}>{value}</span>
    </div>
  );
}
