"use client";

import { useState } from "react";
import { ComposerShell } from "@/components/dashboard/composer/composer-shell";
import { DestinationCard } from "./destination-card";
import { ScheduleCard } from "./schedule-card";
import { CampaignExtras } from "./campaign-extras";
import { StatusBadge } from "./status-badge";
import {
  saveScheduledMessage,
  deleteScheduledMessage,
  duplicateScheduledMessage,
  reorderScheduledMessages,
} from "@/app/dashboard/automations/scheduled/actions";
import { campaignTimeline } from "@/lib/composer/schedule";
import type { ComposerMessageRow } from "@/lib/composer/types";
import type { ScheduledCampaign, ScheduledMessage } from "@/lib/types/database";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";

/** Rótulo do estado da campanha no cabeçalho. */
const STATUS_CAMPANHA: Record<ScheduledCampaign["status"], string> = {
  draft: "rascunho",
  ai_processing: "IA processando",
  ready: "pronta",
  running: "publicando",
  paused: "pausada",
  completed: "concluída",
  failed: "falhou",
};

/**
 * Adaptador da campanha agendada sobre o ComposerShell, espelhando o
 * SocialProofComposer: os cards de destino e agendamento na coluna 1, os
 * campos de envio no editor, o chip de status por bolha, e as Server Actions
 * da campanha já amarradas ao `campaignId`.
 */
export function CampaignComposer({
  campaign,
  messages,
}: {
  campaign: ScheduledCampaign;
  messages: ScheduledMessage[];
}) {
  // A identidade da prévia vem do DESTINO — não existe tabela de canal aqui,
  // e o que o inscrito vai ver é o canal onde a campanha publica.
  const canal: ChannelInput = {
    title: campaign.dest_title ?? "Escolha o destino",
    avatar_url: null,
    subscribers_label: "",
    is_verified: false,
    is_active: campaign.status === "running",
    owner_name: campaign.dest_title ?? "",
    owner_avatar_url: null,
    owner_username: "",
    unread_badge: 0,
  };

  // Um "agora" só, fixado na montagem: recalculá-lo a cada render faria os
  // horários da prévia escorregarem a cada tecla digitada no editor.
  const [agora] = useState(() => new Date());

  // `offset_seconds` é derivado, nunca persistido — e é contado a partir da
  // ÂNCORA, que é o momento da última postagem da sequência, não do agora.
  // Ancorar no agora deixaria toda campanha ainda não publicada com offsets
  // negativos, e `offsetToDate` apara negativo em zero (decisão da Prova
  // Social, travada por teste): as bolhas colapsariam todas no mesmo horário,
  // debaixo de um "Hoje" só. Ver campaignTimeline.
  const { anchor, offsetSeconds } = campaignTimeline(
    messages.map((m) => ({
      id: m.id,
      delay_seconds: m.delay_seconds,
      ai_discarded: m.ai_discarded,
      scheduled_at: m.scheduled_at,
    })),
    campaign.start_at ? new Date(campaign.start_at) : agora,
  );

  const linhas: ComposerMessageRow[] = messages.map((m) => ({
    ...m,
    offset_seconds: offsetSeconds.get(m.id) ?? 0,
  }));

  const porId = new Map(messages.map((m) => [m.id, m]));

  const enviadas = messages.filter((m) => m.status === "sent").length;
  const total = campaign.total_messages || messages.length;

  return (
    <ComposerShell
      title={campaign.name}
      subtitle="Monte a sequência de posts e agende o disparo no canal de destino."
      channel={canal}
      messages={linhas}
      now={anchor}
      leftColumnLabel="Campanha"
      // `pinnedId`/`pinnedText` ficam de fora: a campanha não fixa nada pela
      // UI (o `is_pinned` vem do clone). Ver também `setPinned` lá embaixo.
      leftColumn={
        <>
          <DestinationCard
            campaignId={campaign.id}
            currentDialogId={campaign.dest_dialog_id}
            currentTitle={campaign.dest_title}
            actingTenantId={campaign.tenant_id}
          />
          <ScheduleCard
            campaignId={campaign.id}
            status={campaign.status}
            startAt={campaign.start_at}
            defaultDelaySeconds={campaign.default_delay_seconds}
            hasDestination={campaign.dest_channel_id !== null}
            messages={messages}
          />
        </>
      }
      editorExtras={(value: MessageInput, onChange: (v: MessageInput) => void) => (
        <CampaignExtras value={value} onChange={onChange} campaignId={campaign.id} />
      )}
      messageBadge={(row) => {
        const original = porId.get(row.id);
        return original ? <StatusBadge status={original.status} /> : null;
      }}
      notice={
        campaign.last_error ? (
          <p className="mb-4 rounded-lg border border-(--red) bg-(--red)/10 px-3 py-2 text-sm text-(--red)">
            {campaign.last_error}
          </p>
        ) : null
      }
      headerActions={
        <>
          <span className="rounded-lg border border-(--border-default) px-3 py-2 text-xs text-(--text-secondary)">
            {STATUS_CAMPANHA[campaign.status]}
            {total > 0 && ` · ${enviadas}/${total} enviadas`}
          </span>
          <a
            href="/dashboard/automations"
            className="flex items-center gap-2 rounded-lg border border-(--border-default) px-3 py-2 text-sm text-(--text-secondary) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary)"
          >
            <span className="hidden md:inline">Automações</span>
            <span className="md:hidden">Voltar</span>
          </a>
        </>
      }
      emptyEditorHint="Selecione uma mensagem da fila para ajustar texto, mídia e cadência."
      actions={{
        saveMessage: (input: MessageInput) =>
          saveScheduledMessage(campaign.id, {
            ...input,
            // `offset_seconds` é derivado só pra prévia e não é gravado em
            // lugar nenhum — mas um post futuro o deixa NEGATIVO, e
            // validateMessage (compartilhada com a Prova Social) recusa
            // negativo. Zerar aqui não perde nada e evita uma recusa que não
            // faz sentido nenhum nesta tela.
            offset_seconds: 0,
            // Mensagem nova nasce sem cadência: herda a padrão da campanha, e
            // não o zero que faria dela um disparo colado no anterior.
            delay_seconds: input.delay_seconds ?? campaign.default_delay_seconds,
            silent: input.silent ?? true,
          }),
        deleteMessage: (id) => deleteScheduledMessage(id, campaign.id),
        duplicateMessage: (id) => duplicateScheduledMessage(id, campaign.id),
        reorderMessages: (ids) => reorderScheduledMessages(campaign.id, ids),
        // `setPinned` ausente de propósito: sem ele o shell esconde o botão de
        // fixar, em vez de mostrar um botão morto.
      }}
    />
  );
}
