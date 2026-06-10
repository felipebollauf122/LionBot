"use client";

import { useState, useTransition } from "react";
import { getTrackingEvents, getTrackingLeads } from "@/lib/actions/tracking-actions";
import type { TrackingEvent, Lead } from "@/lib/types/database";

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

const funnelColors: Record<string, string> = {
  page_view: "var(--cyan)",
  bot_start: "var(--cyan)",
  view_offer: "var(--purple)",
  checkout: "var(--amber)",
  purchase: "var(--accent)",
};

const funnelIcons: Record<string, string> = {
  page_view: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z",
  bot_start: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  view_offer: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z",
  checkout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  purchase: "M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3",
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
  const [expandedLead, setExpandedLead] = useState<string | null>(null);

  const maxFunnel = Math.max(...Object.values(funnel), 1);
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground tracking-tight page-title mb-1">Tracking</h1>
      <p className="text-(--text-secondary) text-sm mb-6">Funil de conversao, leads e eventos de rastreamento</p>

      {/* Funnel */}
      <div className="card p-6 mb-6 relative">
        <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--cyan)/15 to-transparent" />
        <h2 className="text-foreground font-semibold text-sm mb-5 tracking-tight">Funil de Conversao</h2>
        <div className="space-y-3">
          {Object.entries(eventTypeLabels).map(([key, label]) => {
            const value = funnel[key] ?? 0;
            const widthPercent = Math.max((value / maxFunnel) * 100, 4);
            const color = funnelColors[key] ?? "var(--accent)";
            const icon = funnelIcons[key];
            return (
              <div key={key} className="flex items-center gap-4">
                <div className="flex items-center gap-2.5 w-32 justify-end">
                  <span className="text-(--text-secondary) text-xs font-medium text-right">{label}</span>
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={icon} />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 rounded-full h-9 overflow-hidden relative" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-subtle)" }}>
                  <div
                    className="h-full rounded-full flex items-center px-3 transition-all duration-700 relative overflow-hidden"
                    style={{ width: `${widthPercent}%`, background: `linear-gradient(135deg, color-mix(in srgb, ${color} 25%, transparent) 0%, color-mix(in srgb, ${color} 12%, transparent) 100%)` }}
                  >
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent" style={{ animation: "shimmer 3s ease-in-out infinite" }} />
                    <span className="text-foreground text-xs font-bold stat-value relative z-10">{value}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {(["leads", "events"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-xs font-bold rounded-lg transition-all ${
              tab === t
                ? "text-white"
                : "bg-white/3 text-(--text-muted) hover:bg-white/6 border border-(--border-subtle)"
            }`}
            style={tab === t ? { background: "linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)", boxShadow: "0 0 16px -4px var(--accent-glow)" } : {}}
          >
            {t === "leads" ? `Leads (${leadsCount})` : `Eventos (${eventsCount})`}
          </button>
        ))}
      </div>

      {/* Leads Tab */}
      {tab === "leads" && (
        <>
          {leads.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-(--text-muted) text-sm">Nenhum lead registrado</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {leads.map((lead) => {
                  const isExpanded = expandedLead === lead.id;
                  const hasUtm = lead.utm_source || lead.utm_medium || lead.utm_campaign || lead.utm_content || lead.utm_term;
                  return (
                    <div key={lead.id} className="card overflow-hidden">
                      <div
                        className="px-5 py-3.5 flex items-center justify-between cursor-pointer hover:bg-white/2 transition-colors"
                        onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--cyan) 10%, transparent)" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
                            </svg>
                          </div>
                          <div>
                            <span className="text-foreground text-sm font-medium">{lead.first_name}</span>
                            {lead.username && (
                              <span className="text-(--text-ghost) text-xs ml-2">@{lead.username}</span>
                            )}
                          </div>
                          {lead.utm_source && (
                            <span className="badge badge-purple text-[10px]">{lead.utm_source}</span>
                          )}
                          {lead.tid && (
                            <span className="text-(--text-ghost) text-[10px] font-mono stat-value">{lead.tid}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-(--text-muted) text-xs">
                            {new Date(lead.created_at).toLocaleString("pt-BR")}
                          </span>
                          <div className={`w-6 h-6 rounded-md bg-white/4 flex items-center justify-center transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-(--border-subtle) px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 animate-in relative">
                          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--cyan)/10 to-transparent" />
                          {[
                            ["Telegram ID", String(lead.telegram_user_id)],
                            ["TID", lead.tid ?? "—"],
                            ["fbclid", lead.fbclid ?? "—"],
                            ["utm_source", lead.utm_source ?? "—"],
                            ["utm_medium", lead.utm_medium ?? "—"],
                            ["utm_campaign", lead.utm_campaign ?? "—"],
                            ["utm_content", lead.utm_content ?? "—"],
                            ["utm_term", lead.utm_term ?? "—"],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <p className="text-(--text-ghost) text-[9px] uppercase tracking-[0.1em] font-bold mb-1">{label}</p>
                              <p className="text-(--text-secondary) text-xs font-mono stat-value">{value}</p>
                            </div>
                          ))}
                          {!hasUtm && (
                            <div className="col-span-full">
                              <p className="text-(--text-ghost) text-xs">Nenhum parametro UTM capturado (lead entrou sem link de tracking)</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {leadsTotalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-5">
                  <button onClick={() => loadLeadsPage(leadsPage - 1)} disabled={leadsPage <= 1 || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">Anterior</button>
                  <span className="text-(--text-muted) text-sm stat-value px-3 py-1.5 rounded-lg bg-white/3">{leadsPage} / {leadsTotalPages}</span>
                  <button onClick={() => loadLeadsPage(leadsPage + 1)} disabled={leadsPage >= leadsTotalPages || isPending} className="btn-ghost py-2! px-4! disabled:opacity-30">Proxima</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Events Tab */}
      {tab === "events" && (
        <>
          {events.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-(--text-muted) text-sm">Nenhum evento registrado</p>
            </div>
          ) : (
            <>
              <div className="card overflow-hidden relative">
                <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-(--accent)/15 to-transparent" />
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-(--border-subtle)">
                      <th className="table-header">Evento</th>
                      <th className="table-header">TID</th>
                      <th className="table-header">UTM Source</th>
                      <th className="table-header">fbclid</th>
                      <th className="table-header">FB</th>
                      <th className="table-header">Utmify</th>
                      <th className="table-header">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => {
                      const utmSource = (event.utm_params as Record<string, string>)?.utm_source;
                      return (
                        <tr key={event.id} className="hover:bg-white/2 transition-colors">
                          <td className="table-cell">
                            <span className={`badge ${eventBadgeClass[event.event_type] ?? "badge-inactive"}`}>
                              {eventTypeLabels[event.event_type] ?? event.event_type}
                            </span>
                          </td>
                          <td className="table-cell text-(--text-muted) text-xs font-mono stat-value">{event.tid ?? "—"}</td>
                          <td className="table-cell">
                            {utmSource ? (
                              <span className="badge badge-purple">{utmSource}</span>
                            ) : (
                              <span className="text-(--text-ghost)">—</span>
                            )}
                          </td>
                          <td className="table-cell text-(--text-muted) text-xs font-mono">
                            {event.fbclid ? event.fbclid.slice(0, 12) + "..." : "—"}
                          </td>
                          <td className="table-cell">
                            {event.sent_to_facebook ? (
                              <span className="text-(--accent) text-xs font-bold">OK</span>
                            ) : (
                              <span className="text-(--text-ghost) text-xs">—</span>
                            )}
                          </td>
                          <td className="table-cell">
                            {event.sent_to_utmify ? (
                              <span className="text-(--accent) text-xs font-bold">OK</span>
                            ) : (
                              <span className="text-(--text-ghost) text-xs">—</span>
                            )}
                          </td>
                          <td className="table-cell text-(--text-muted) text-xs">
                            {new Date(event.created_at).toLocaleString("pt-BR")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
        </>
      )}
    </div>
  );
}
