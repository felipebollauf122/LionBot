"use client";

import { useState } from "react";
import Link from "next/link";
import { ComposerShell } from "@/components/dashboard/composer/composer-shell";
import { DestinationCard } from "./destination-card";
import { ScheduleCard } from "./schedule-card";
import { CampaignExtras } from "./campaign-extras";
import { AiCard } from "./ai-card";
import { StatusBadge } from "./status-badge";
import {
  saveScheduledMessage,
  deleteScheduledMessage,
  duplicateScheduledMessage,
  reorderScheduledMessages,
  aiAssist,
} from "@/app/dashboard/automations/scheduled/actions";
import { campaignTimeline } from "@/lib/composer/schedule";
import { earliestFloodWait, describeFloodWait } from "@/lib/composer/flood-wait";
import type { AiAssistAction, ComposerMessageRow } from "@/lib/composer/types";
import type { ScheduledCampaign, ScheduledMessage } from "@/lib/types/database";
import type { ChannelInput, MessageInput } from "@/lib/social-proof/types";

/** Rótulo do estado da campanha no cabeçalho. */
const STATUS_CAMPANHA: Record<ScheduledCampaign["status"], string> = {
  draft: "rascunho",
  ai_processing: "IA processando",
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
  returnHref = "/dashboard/automations/scheduled/campaigns",
  sourceClone,
}: {
  campaign: ScheduledCampaign;
  messages: ScheduledMessage[];
  returnHref?: string;
  sourceClone?: { id: string; status: string; copied_count: number; last_error: string | null } | null;
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

  // Espera de limite do Telegram em curso (Ruling 23): sem isto a tela fica
  // parada por horas sem dizer por quê, e uma campanha esperando parece
  // travada. Calculado das linhas reais, não do status da campanha — ela
  // continua 'running' durante a espera.
  const flood = earliestFloodWait(messages);
  const importing = !!sourceClone && ["draft", "running", "waiting_flood"].includes(sourceClone.status);
  const importIncomplete = !!sourceClone && sourceClone.status !== "completed";

  // Ligado uma vez só e reusado em dois lugares (`actions.aiAssist`, que
  // completa a interface, e o `onAssist` que de fato chega no editor via
  // `editorExtras` — ver o comentário em CampaignExtras sobre por que
  // `editorExtras` não recebe `actions` do ComposerShell).
  const aiAssistBound = (id: string, action: AiAssistAction) => aiAssist(id, campaign.id, action);

  return (
    <ComposerShell
      focused
      busy={importing || campaign.status === "ai_processing"}
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
            importIncomplete={importIncomplete}
          />
          <AiCard
            aiStatus={campaign.ai_status}
            aiProcessedCount={campaign.ai_processed_count}
            totalMessages={total}
            aiError={campaign.ai_error}
          />
        </>
      }
      editorExtras={(value: MessageInput, onChange: (v: MessageInput) => void) => {
        const original = value.id ? porId.get(value.id) : undefined;
        return (
          <CampaignExtras
            value={value}
            onChange={onChange}
            campaignId={campaign.id}
            status={original?.status ?? null}
            errorMessage={original?.error_message ?? null}
            onAssist={aiAssistBound}
          />
        );
      }}
      messageBadge={(row) => {
        const original = porId.get(row.id);
        return original ? (
          <StatusBadge
            status={original.status}
            errorMessage={original.error_message}
            scheduledAt={original.scheduled_at}
            now={agora}
          />
        ) : null;
      }}
      notice={
        importIncomplete ? (
          <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-(--bg-overlay) px-4 py-3 text-sm text-(--text-secondary)">
            <p>{importing ? `Importando conteúdo: ${sourceClone?.copied_count ?? 0} mensagens copiadas. A tela atualiza automaticamente.` : "A importação ainda não foi concluída. Confira o clone antes de publicar."}</p>
            <Link href={returnHref.replace("/scheduled", `/clones/${sourceClone?.id}`)} className="font-medium text-(--accent) underline">Acompanhar clone</Link>
          </div>
        ) : flood ? (
          <p className="mb-4 rounded-lg border border-(--amber) bg-(--amber-muted) px-3 py-2 text-sm text-(--amber)">
            {describeFloodWait(flood, agora)}
          </p>
        ) : campaign.last_error ? (
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
          <Link
            href={returnHref}
            className="flex items-center gap-2 rounded-lg border border-(--border-default) px-3 py-2 text-sm text-(--text-secondary) transition-colors hover:bg-(--bg-hover) hover:text-(--text-primary)"
          >
            <span className="hidden md:inline">Postagens</span>
            <span className="md:hidden">Voltar</span>
          </Link>
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
        aiAssist: aiAssistBound,
      }}
    />
  );
}
