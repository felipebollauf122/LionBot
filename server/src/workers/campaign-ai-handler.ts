// Worker de tratamento por IA do rascunho de clone (Plano 3): consome
// GeminiClient (Task 1) e buildTreatmentPrompt/applyTreatment (Task 2) pra
// limpar menções/links, opcionalmente reescrever e definir cadência de cada
// mensagem raspada, tudo antes do dono abrir a tela de revisão.
//
// O núcleo (`processarCampanhaIa`) recebe as bordas de I/O injetadas —
// mesmo padrão de CloneRunnerDeps/PollerDeps já usado no repo — de propósito:
// uma lição do Plano 2 é que testar só a função pura (aqui,
// buildTreatmentPrompt/applyTreatment) não prova que o worker REALMENTE a
// alcança. Com deps injetadas dá pra rodar applyTreatment/buildTreatmentPrompt
// DE VERDADE nos testes e só substituir claim/leitura/rede/escrita.
import { supabase } from "../db.js";
import { config } from "../config.js";
import { enqueueMtproto } from "../queue-mtproto.js";
import { GeminiClient } from "../services/ai/gemini.js";
import {
  applyTreatment,
  buildTreatmentPrompt,
  type AiTreatment,
  type DraftMessageForAi,
  type TreatmentOptions,
} from "../services/ai/content-treatment.js";

const TAMANHO_LOTE = 20;
const JANELA_CONTEXTO = 2;
/** Janela de obsolescência da trava, mesmo padrão de 030/050/clone-handler. */
export const AI_CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Fatia em lotes, cada um carregando as últimas `contexto` mensagens do lote
 * anterior apenas para leitura. Sem essa janela, a cadência quebra na emenda
 * entre lotes: a IA não tem como decidir o intervalo do primeiro item sem
 * saber o que veio antes dele.
 */
export function fatiarComContexto<T>(
  itens: T[],
  tamanho: number,
  contexto: number,
): Array<{ lote: T[]; contexto: T[] }> {
  const out: Array<{ lote: T[]; contexto: T[] }> = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    out.push({
      lote: itens.slice(i, i + tamanho),
      contexto: itens.slice(Math.max(0, i - contexto), i),
    });
  }
  return out;
}

export type AiFinalStatus = "done" | "partial" | "failed";

/** O que o claim devolve: só as alavancas, que é tudo que o loop precisa. */
export interface ClaimedCampaign {
  opts: TreatmentOptions;
}

/** Uma linha do rascunho já traduzida pro formato que a IA e o patch usam. */
export interface DraftRowForAi {
  id: string;
  contentText: string | null;
  contentTextOriginal: string | null;
  paraIa: DraftMessageForAi;
}

/**
 * Bordas de I/O do processamento em lote. Injetadas pra a decisão — "o que
 * cada lote produz, o que acontece quando um lote falha, quando finalizar
 * com qual status" — ser testável sem Postgres nem rede, sem abrir mão de
 * rodar buildTreatmentPrompt/applyTreatment de verdade.
 */
export interface CampaignAiDeps {
  /** Claim CAS com TTL. null = não reivindicada (outro worker, ou fora do estado 'queued'/'failed'). */
  reivindicar(campaignId: string, agora: Date): Promise<ClaimedCampaign | null>;
  /** Barato e síncrono de propósito: checado ANTES de gastar a query de listagem. */
  geminiConfigurado(): boolean;
  /** Todas as mensagens do rascunho, em ordem de posição. */
  listarMensagens(campaignId: string): Promise<DraftRowForAi[]>;
  /** Uma chamada ao Gemini para um lote. Pode lançar — quem chama decide o que fazer. */
  chamarIa(prompt: { system: string; user: string; schema: object }): Promise<{ itens: AiTreatment[] }>;
  /** Aplica o patch já resolvido por applyTreatment numa linha. */
  aplicarPatch(messageId: string, patch: Record<string, unknown>): Promise<void>;
  /** Progresso incremental — reportado por lote, não só no fim. */
  atualizarProgresso(campaignId: string, processadas: number): Promise<void>;
  /** Encerra a fase de IA e devolve a campanha pra revisão humana. */
  finalizar(campaignId: string, status: AiFinalStatus, erro: string | null): Promise<void>;
}

/**
 * Processa o rascunho inteiro em lotes de TAMANHO_LOTE, cada um com
 * JANELA_CONTEXTO mensagens do lote anterior como contexto de leitura.
 *
 * Duas garantias que este loop existe pra proteger:
 * - um lote que lança (ex.: quota do Gemini) NÃO derruba os demais: loga,
 *   segue pro próximo, e a campanha termina 'partial' (ou 'failed' só se
 *   NADA foi processado) — o dono prefere 80% tratado a um rascunho refém
 *   de um erro de quota;
 * - mensagens de contexto nunca viram item aplicado: o loop de escrita
 *   percorre só `lote`, nunca `contexto`, então mesmo que a resposta do
 *   modelo traga (por engano) um id que só existe como contexto, ele nunca
 *   é procurado pra esse lote.
 */
export async function processarCampanhaIa(campaignId: string, deps: CampaignAiDeps): Promise<void> {
  const claimed = await deps.reivindicar(campaignId, new Date());
  if (!claimed) {
    console.log(`[campaign-ai] ${campaignId} não reivindicada, ignorando`);
    return;
  }

  if (!deps.geminiConfigurado()) {
    await deps.finalizar(campaignId, "failed", "GEMINI_API_KEY não configurada no worker");
    return;
  }

  const todas = await deps.listarMensagens(campaignId);

  let processadas = 0;
  let houveFalha = false;

  for (const { lote, contexto } of fatiarComContexto(todas, TAMANHO_LOTE, JANELA_CONTEXTO)) {
    try {
      const prompt = buildTreatmentPrompt(
        lote.map((l) => l.paraIa),
        contexto.map((c) => c.paraIa),
        claimed.opts,
      );
      const resposta = await deps.chamarIa(prompt);
      const porId = new Map(resposta.itens.map((t) => [t.id, t]));

      for (const linha of lote) {
        const t = porId.get(linha.id);
        if (!t) continue; // o modelo omitiu: mantém como está
        const patch = applyTreatment(
          { content_text: linha.contentText, content_text_original: linha.contentTextOriginal },
          t,
          claimed.opts,
        );
        if (!patch) continue;
        await deps.aplicarPatch(linha.id, patch);
      }
      processadas += lote.length;
      await deps.atualizarProgresso(campaignId, processadas);
    } catch (err) {
      // Lote que falha NÃO derruba o rascunho: o dono prefere 80% tratado a
      // um rascunho travado esperando quota voltar.
      houveFalha = true;
      console.error(
        `[campaign-ai] lote da campanha ${campaignId} falhou (seguindo):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  await deps.finalizar(
    campaignId,
    houveFalha ? (processadas > 0 ? "partial" : "failed") : "done",
    houveFalha ? "um ou mais lotes falharam — o conteúdo não tratado ficou como veio" : null,
  );
}

/** Fiação real: reivindica no Supabase, chama o Gemini de verdade, escreve no Supabase. */
export async function handleCampaignAiProcess(campaignId: string): Promise<void> {
  const gemini = new GeminiClient(config.geminiApiKey, config.geminiModel);

  const deps: CampaignAiDeps = {
    async reivindicar(id, agora) {
      // Claim CAS com TTL, mesmo padrão de 030/050. Sem isso a campanha fica
      // presa em ai_processing pra sempre se o worker morrer no meio.
      const stale = new Date(agora.getTime() - AI_CLAIM_STALE_MS).toISOString();
      const { data, error } = await supabase
        .from("mtproto_scheduled_campaigns")
        .update({ ai_status: "processing", ai_started_at: agora.toISOString() })
        .eq("id", id)
        .in("ai_status", ["queued", "failed"])
        .or(`ai_started_at.is.null,ai_started_at.lt.${stale}`)
        .select("ai_clean, ai_rewrite, ai_smart_delay")
        .maybeSingle();
      if (error) {
        // Erro de verdade (filtro malformado, conectividade, permissão) é
        // uma classe diferente de "outro worker já reivindicou" — antes esta
        // função destructurava só `{ data }` e descartava `error`, então os
        // dois casos ficavam indistinguíveis e uma falha real neste worker
        // desassistido não deixava sinal diagnóstico nenhum (mesmo padrão de
        // clone-handler.ts).
        console.error(`[campaign-ai] falha ao reivindicar trava da campanha ${id}: ${error.message}`);
        return null;
      }
      if (!data) return null;
      return {
        opts: {
          clean: Boolean(data.ai_clean),
          rewrite: Boolean(data.ai_rewrite),
          smartDelay: Boolean(data.ai_smart_delay),
        },
      };
    },

    geminiConfigurado: () => gemini.isConfigured(),

    async listarMensagens(id) {
      const { data: rows } = await supabase
        .from("mtproto_scheduled_messages")
        .select("id, position, content_text, content_text_original, media, inline_links")
        .eq("campaign_id", id)
        .order("position", { ascending: true });

      return (rows ?? []).map((r) => ({
        id: r.id as string,
        contentText: r.content_text as string | null,
        contentTextOriginal: r.content_text_original as string | null,
        paraIa: {
          id: r.id as string,
          position: r.position as number,
          text: r.content_text as string | null,
          // A IA precisa saber que há mídia pra escrever legenda coerente.
          mediaKinds: ((r.media as Array<{ type: string }>) ?? []).map((m) => m.type),
          hasButtons: Boolean(r.inline_links),
        },
      }));
    },

    chamarIa: (prompt) => gemini.generateJson<{ itens: AiTreatment[] }>(prompt),

    async aplicarPatch(messageId, patch) {
      await supabase.from("mtproto_scheduled_messages").update(patch).eq("id", messageId);
    },

    async atualizarProgresso(id, processadas) {
      await supabase
        .from("mtproto_scheduled_campaigns")
        .update({ ai_processed_count: processadas })
        .eq("id", id);
    },

    async finalizar(id, status, erro) {
      await supabase
        .from("mtproto_scheduled_campaigns")
        .update({ ai_status: status, ai_error: erro, status: "draft" })
        .eq("id", id);
    },
  };

  await processarCampanhaIa(campaignId, deps);
}

// ---------------------------------------------------------------------------
// tickCampaignAiStuckWatchdog — chamado por um setInterval em queue.ts.
// Espelha tickBotCloneStuckJobsWatchdog (bot-clone-handler.ts): campaign.ai-
// process é enfileirado uma ÚNICA vez, por clone-handler.ts, com attempts:2 e
// backoff fixo de 3s (queue-mtproto.ts) — muitíssimo menor que
// AI_CLAIM_STALE_MS (10min). Se o worker morre no meio de um lote, o retry do
// BullMQ chega cedo demais: a trava CAS (ai_started_at) ainda está fresca,
// reivindicar() não pega (ai_status continua 'processing'), as 2 tentativas
// se esgotam, e ninguém jamais reenfileira de novo — a campanha fica presa em
// status='ai_processing'/ai_status='processing' pra sempre, e o dono vê "IA
// processando" sem fim. setInterval, não BullMQ repeat: este codebase não usa
// essa feature em lugar nenhum (mesmo padrão do watchdog do bot-clone e dos
// outros pollers em queue.ts).
// ---------------------------------------------------------------------------

/**
 * O que o watchdog precisa pra decidir e agir, sem tocar banco/fila
 * diretamente — mesmo motivo de CampaignAiDeps: a decisão (quais campanhas
 * estão travadas o bastante pra merecer reenfileiramento, e o que fazer com
 * cada uma) precisa ser testável sem Postgres.
 */
export interface CampaignAiWatchdogDeps {
  /** Ids de campanhas com ai_status='processing' e ai_started_at anterior a staleBefore. */
  listarTravadas(staleBefore: Date): Promise<string[]>;
  /** CAS: só destrava (ai_status -> 'queued') se ainda estiver 'processing'. Devolve se destravou. */
  destravar(campaignId: string): Promise<boolean>;
  /** Reenfileira campaign.ai-process pra uma campanha recém-destravada. */
  reenfileirar(campaignId: string): Promise<void>;
}

/**
 * Decisão pura do watchdog: lista as travadas, tenta destravar cada uma por
 * CAS — o que protege contra duas varreduras concorrentes (ou uma varredura
 * e o próprio worker) disputando a mesma campanha: quem perde o CAS não
 * reenfileira de novo, evitando um reenfileiramento duplicado.
 */
export async function varrerCampanhasIaTravadas(
  deps: CampaignAiWatchdogDeps,
  agora: Date = new Date(),
): Promise<void> {
  const staleBefore = new Date(agora.getTime() - AI_CLAIM_STALE_MS);
  const travadas = await deps.listarTravadas(staleBefore);
  for (const campaignId of travadas) {
    const destravou = await deps.destravar(campaignId);
    if (!destravou) continue; // outra varredura (ou o próprio worker) já resolveu nesse meio-tempo
    console.warn(
      `[campaign-ai.watchdog] campanha ${campaignId} travada em ai_status='processing' (worker provavelmente caiu no meio do lote) — reiniciando pra retomar`,
    );
    await deps.reenfileirar(campaignId).catch((err) =>
      console.error(`[campaign-ai.watchdog] reenqueue falhou pra campanha ${campaignId}:`, err),
    );
  }
}

/** Fiação real: reivindica a lista no Supabase, destrava por CAS, reenfileira no BullMQ. */
export async function tickCampaignAiStuckWatchdog(): Promise<void> {
  const deps: CampaignAiWatchdogDeps = {
    async listarTravadas(staleBefore) {
      const { data } = await supabase
        .from("mtproto_scheduled_campaigns")
        .select("id")
        .eq("ai_status", "processing")
        .lt("ai_started_at", staleBefore.toISOString())
        .limit(50);
      return (data ?? []).map((r) => r.id as string);
    },
    async destravar(campaignId) {
      const { data } = await supabase
        .from("mtproto_scheduled_campaigns")
        .update({ ai_status: "queued", ai_started_at: null })
        .eq("id", campaignId)
        .eq("ai_status", "processing")
        .select("id")
        .maybeSingle();
      return Boolean(data);
    },
    async reenfileirar(campaignId) {
      await enqueueMtproto({ kind: "campaign.ai-process", campaignId });
    },
  };
  await varrerCampanhasIaTravadas(deps);
}
