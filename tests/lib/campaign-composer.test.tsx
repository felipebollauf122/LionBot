import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { CampaignComposer } from "@/components/dashboard/campaigns/campaign-composer";
import type { ScheduledCampaign, ScheduledMessage } from "@/lib/types/database";

// Mesmo motivo de campaign-timeline.test.tsx: components/telegram/fonts.ts
// chama next/font/google em tempo de módulo, o que só existe dentro do build
// do Next.
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "mock-tgc-font-inter" }),
  Roboto: () => ({ variable: "mock-tgc-font-roboto" }),
}));

// CampaignComposer e os cards da coluna 1 (DestinationCard, ScheduleCard,
// CampaignExtras) importam as Server Actions da campanha direto do módulo —
// mocka-se o módulo inteiro pra render() não tentar mesmo chamar Supabase.
vi.mock("@/app/dashboard/automations/scheduled/actions", () => ({
  listDestinationDialogs: vi.fn(async () => []),
  setCampaignDestination: vi.fn(async () => ({ ok: true })),
  saveScheduledMessage: vi.fn(async () => ({ ok: true })),
  deleteScheduledMessage: vi.fn(async () => ({ ok: true })),
  duplicateScheduledMessage: vi.fn(async () => ({ ok: true })),
  reorderScheduledMessages: vi.fn(async () => ({ ok: true })),
  setCampaignSchedule: vi.fn(async () => ({ ok: true })),
  launchScheduledCampaign: vi.fn(async () => ({ ok: true })),
  pauseScheduledCampaign: vi.fn(async () => ({ ok: true })),
  revertAiText: vi.fn(async () => ({ ok: true })),
  toggleDiscarded: vi.fn(async () => ({ ok: true })),
  ensureBotAccessOnDestination: vi.fn(async () => ({ ok: true })),
}));

function campanha(over: Partial<ScheduledCampaign> = {}): ScheduledCampaign {
  return {
    id: "camp-1",
    tenant_id: "tenant-1",
    name: "Campanha de teste",
    dest_dialog_id: "dialog-1",
    dest_channel_id: "123",
    dest_access_hash: "456",
    dest_title: "Canal de destino",
    source_clone_job_id: null,
    status: "draft",
    start_at: null,
    default_delay_seconds: 900,
    ai_clean: false,
    ai_rewrite: false,
    ai_smart_delay: false,
    ai_status: "idle",
    ai_processed_count: 0,
    ai_error: null,
    ai_started_at: null,
    total_messages: 0,
    sent_count: 0,
    failed_count: 0,
    last_error: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function mensagem(over: Partial<ScheduledMessage> & { id: string }): ScheduledMessage {
  return {
    tenant_id: "tenant-1",
    campaign_id: "camp-1",
    kind: "text",
    content_text: "Post",
    media: [],
    reply_to_id: null,
    position: 0,
    delay_seconds: 0,
    scheduled_at: null,
    silent: true,
    status: "pending",
    dest_msg_id: null,
    sent_at: null,
    error_message: null,
    attempts: 0,
    claimed_at: null,
    source_msg_id: null,
    entities: null,
    inline_links: null,
    poll: null,
    file_name: null,
    is_pinned: false,
    content_text_original: null,
    ai_action: null,
    ai_reason: null,
    ai_discarded: false,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** Os horários que a prévia desenhou, na ordem das bolhas. */
function horariosNaTela(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".tg-meta")].map((e) => e.textContent ?? "");
}

describe("CampaignComposer ancora a prévia na última postagem da sequência", () => {
  it("desenha os horários REAIS agendados, não o relógio da máquina no momento do render", () => {
    // As três mensagens têm `scheduled_at` real, longe de "hoje" (o teste roda
    // em 2026; isto é 2027) de propósito: se campaign-composer.tsx trocar
    // `now={anchor}` por `now={agora}` (ou por `new Date()`), a prévia passa a
    // desenhar horários relativos ao instante do teste em vez dos horários
    // agendados de verdade — e não bateria com os valores fixos abaixo. É
    // exatamente a regressão que o Ruling 20 (SDD desta branch) já corrigiu
    // uma vez; este teste é o buraco de cobertura que faltava sobre o
    // ADAPTADOR (CampaignComposer), não só sobre campaignTimeline/FeedPreview
    // isoladas.
    const messages: ScheduledMessage[] = [
      mensagem({ id: "m1", position: 0, scheduled_at: "2027-06-15T09:00:00-03:00" }),
      mensagem({ id: "m2", position: 1, scheduled_at: "2027-06-15T10:00:00-03:00" }),
      mensagem({ id: "m3", position: 2, scheduled_at: "2027-06-15T11:00:00-03:00" }),
    ];

    const { container } = render(
      <CampaignComposer campaign={campanha({ start_at: "2027-06-15T09:00:00-03:00" })} messages={messages} />,
    );

    expect(horariosNaTela(container)).toEqual(["09:00", "10:00", "11:00"]);
  });
});

describe("aviso de limite do Telegram (Ruling 23)", () => {
  it("o chip da mensagem em espera explica o motivo no hover, em português, sem a string crua", () => {
    const messages: ScheduledMessage[] = [
      mensagem({
        id: "m1",
        status: "pending",
        error_message: "flood_wait_120s",
        scheduled_at: "2027-06-15T09:05:00-03:00",
      }),
    ];

    const { container } = render(
      <CampaignComposer campaign={campanha({ status: "running" })} messages={messages} />,
    );

    const chip = [...container.querySelectorAll(".tg-feed__badge span")].find((e) =>
      e.textContent?.includes("aguardando"),
    );
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("title")).toContain("09:05");
    expect(chip?.getAttribute("title")?.toLowerCase()).not.toContain("flood");
  });

  it("a tela avisa quando a campanha está esperando o limite do Telegram, com o horário que ela volta", () => {
    const messages: ScheduledMessage[] = [
      mensagem({
        id: "m1",
        status: "pending",
        error_message: "flood_wait_600s",
        scheduled_at: "2027-06-15T14:30:00-03:00",
      }),
    ];

    render(<CampaignComposer campaign={campanha({ status: "running" })} messages={messages} />);

    expect(document.body.textContent).toContain("14:30");
    expect(document.body.textContent).toContain("Telegram");
  });

  it("sem espera em curso, nenhum aviso de limite aparece", () => {
    const messages: ScheduledMessage[] = [mensagem({ id: "m1", status: "pending" })];

    render(<CampaignComposer campaign={campanha({ status: "running" })} messages={messages} />);

    expect(document.body.textContent).not.toContain("limitou o envio");
  });
});
