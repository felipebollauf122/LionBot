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

alter table public.clone_jobs
  add column if not exists processing_started_at timestamptz;

create index if not exists idx_clone_jobs_processing
  on public.clone_jobs(processing_started_at)
  where processing_started_at is not null;
