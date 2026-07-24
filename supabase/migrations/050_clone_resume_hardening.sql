-- Endurece a retomada de clone_jobs (revisão adversarial da branch, defeito
-- I6b): trava de execução por job, mesmo padrão de
-- 030_mtproto_campaign_processing_lock.sql (CAS via UPDATE...WHERE...
-- RETURNING). Sem isso, um resume atrasado da fila (scheduleResume, com
-- delay) e um novo launchClone (ou dois workers) podem processar o mesmo job
-- em paralelo: os dois runners carregam o mesmo cursor persistido e chamam
-- publish() — que NÃO é idempotente — pro mesmo lote, duplicando posts no
-- destino (o upsert em clone_message_map só dedupa a linha do mapa, não o
-- envio real ao Telegram).
--
-- Diferente de mtproto_campaigns (boolean is_processing + CAS em duas
-- queries), aqui basta a própria coluna de timestamp: reivindicar é um único
-- UPDATE condicionado a "livre ou velha o bastante pra presumir crash"
-- (handleCloneRun em clone-handler.ts), sem precisar de um SELECT prévio.
--
-- Re-review (issue 2, TOCTOU): o WHERE desse UPDATE também precisa checar
-- status IN ('running','waiting_flood') — não só a coluna aqui adicionada.
-- Sem isso, uma pausa emitida entre a leitura do job e este claim passava
-- batido (o status era lido uma vez, bem antes do UPDATE, e nunca
-- revisitado): o claim reivindicava a trava pra um job que já não deveria
-- rodar mais. Dobrando a condição de status pra dentro do próprio WHERE do
-- claim, ele e a guarda de status viram uma operação atômica só — não há
-- mais janela entre "ler status" e "reivindicar trava" pra uma pausa se
-- intrometer. Nenhuma coluna nova precisa disso: `status` já existe desde
-- 049_channel_clone.sql.

alter table public.clone_jobs
  add column if not exists processing_started_at timestamptz;

create index if not exists idx_clone_jobs_processing
  on public.clone_jobs(processing_started_at)
  where processing_started_at is not null;
