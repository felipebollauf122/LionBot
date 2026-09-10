// Fecho do clone em modo rascunho: leva a campanha do "sendo raspada" pro
// estado que a tela de revisão (ou a fase de IA) espera.
//
// Mora em módulo próprio, e não solto dentro de clone-handler.ts, por um
// motivo prático: clone-handler importa gramjs, o CloneRunner inteiro e o
// bot companheiro no topo, então nenhum teste consegue alcançar esta decisão
// sem montar meio worker. Aqui as únicas bordas são o Supabase e a fila —
// as duas que os testes deste repo já sabem substituir.
import { supabase } from "../../../db.js";
import { enqueueMtproto } from "../../../queue-mtproto.js";

/**
 * Estados em que a campanha do rascunho ainda PERTENCE ao clone.
 *
 * Este é o CAS que faltava (bloqueador da revisão): a escrita original levava
 * só `.eq("id", campaignId)`, então re-rodar um clone cuja campanha já tinha
 * sido publicada a devolvia pra 'draft'/'ai_processing' E sobrescrevia
 * `total_messages` no meio da sequência. Como o poller só enfileira
 * status='running' (queue.ts), a publicação parava sem erro nenhum.
 */
const ESTADOS_DO_RASCUNHO = ["draft", "ai_processing"];

/**
 * Grava o desfecho do clone na campanha e, se alguma alavanca de IA estiver
 * ligada, enfileira o tratamento.
 *
 * Devolve `false` quando o CAS não pegou nenhuma linha — a campanha já saiu
 * do rascunho (publicando, pausada, concluída) e NADA é escrito nela, nem o
 * tratamento de IA é enfileirado: gastar quota do Gemini reescrevendo posts
 * de uma campanha que já está no ar seria o mesmo estrago por outra porta.
 */
export async function finalizarCampanhaDoRascunho(
  campaignId: string,
  totalMensagens: number,
  querIa: boolean,
): Promise<boolean> {
  const { data } = await supabase
    .from("mtproto_scheduled_campaigns")
    .update({
      total_messages: totalMensagens,
      // A fase de IA (Plano 3) consome 'queued'. Sem alavanca ligada,
      // o rascunho já nasce pronto pra revisão humana.
      status: querIa ? "ai_processing" : "draft",
      ai_status: querIa ? "queued" : "idle",
    })
    .eq("id", campaignId)
    .in("status", ESTADOS_DO_RASCUNHO)
    .select("id")
    .maybeSingle();

  if (!data) {
    console.warn(
      `[clone] campanha ${campaignId} já não está em rascunho — o resultado do clone não sobrescreve o estado dela (nem o total de mensagens, nem a fase de IA)`,
    );
    return false;
  }

  // Enfileiramento que o Plano 1 adiou explicitamente porque o kind
  // ainda não existia (Plano 3 o criou em campaign-ai-handler.ts).
  //
  // Um enqueue que falha aqui deixa a campanha em ai_status='queued' sem job
  // na fila; quem tira ela de lá é o watchdog de campaign-ai-handler.ts, que
  // varre 'queued' justamente por causa deste caminho.
  if (querIa) {
    await enqueueMtproto({ kind: "campaign.ai-process", campaignId });
  }
  return true;
}
