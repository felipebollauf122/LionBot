export const automationSections = [
  { id: "overview", path: "/dashboard/automations", label: "Visão geral", description: "Escolha o que você quer automatizar." },
  { id: "scheduled", path: "/dashboard/automations/scheduled", label: "Postagens", description: "Prepare o conteúdo, revise com IA e agende a publicação em um canal." },
  { id: "clones", path: "/dashboard/automations/clones", label: "Clonar canais", description: "Copie canais e grupos ou transforme o conteúdo em um rascunho para revisar." },
  { id: "botclones", path: "/dashboard/automations/botclones", label: "Clonar bots", description: "Reconstrua o fluxo de conversa de um bot dentro de um dos seus bots." },
  { id: "campaigns", path: "/dashboard/automations/campaigns", label: "Disparos", description: "Organize campanhas de mensagens e acompanhe os envios pelas contas conectadas." },
  { id: "channel-monitors", path: "/dashboard/automations/channel-monitors", label: "Monitoramento", description: "Monitore seus canais e configure a criação de um substituto em caso de queda." },
  { id: "accounts", path: "/dashboard/automations/accounts", label: "Contas Telegram", description: "Conecte contas, sincronize canais e acesse suas conversas." },
  { id: "companion", path: "/dashboard/automations/companion", label: "Bot de publicação", description: "Configure o bot que publica os clones e as postagens agendadas." },
] as const;

export type AutomationSectionId = typeof automationSections[number]["id"];
export type AutomationSearchParams = { [key: string]: string | string[] | undefined };

export function automationSectionForPath(pathname: string) {
  if (pathname === "/dashboard/automations/new-campaign") return automationSections[4];
  return automationSections.slice(1).find((section) =>
    pathname === section.path || pathname.startsWith(`${section.path}/`),
  ) ?? automationSections[0];
}

/** Carry only the viewing scope, never a dialog or editor-specific query. */
export function automationHref(path: string, view?: string | null) {
  // Monitor APIs are explicitly owner-scoped; never imply an admin tenant here.
  if (path === "/dashboard/automations/channel-monitors") return path;
  if (!view || view === "mine") return path;
  return `${path}${path.includes("?") ? "&" : "?"}view=${encodeURIComponent(view)}`;
}
