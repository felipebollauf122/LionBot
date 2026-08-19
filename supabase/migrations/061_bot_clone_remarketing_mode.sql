-- Clone "só remarketing": reaproveita o pipeline MTProto existente
-- (054_bot_flow_clone.sql) sem rodar o BFS completo do fluxo principal —
-- vai direto pra captureHistoricalRemarketing (lê o histórico real que a
-- conta exploradora já tem com o bot-alvo). include_media deixa a etapa de
-- rehost de mídia opcional em qualquer um dos dois modos.
--
-- Não interage com uq_bot_clone_jobs_active_target (só bloqueia jobs não
-- concluídos no mesmo par conta+alvo) — reexecutar remarketing_only num par
-- que já tem um job 'completed' continua permitido, é exatamente o caso de
-- uso (deixar a conta "descansando" pra acumular remarketing novo e depois
-- reler).
alter table public.bot_clone_jobs
  add column if not exists mode text not null default 'full' check (mode in ('full', 'remarketing_only')),
  add column if not exists include_media boolean not null default true;
