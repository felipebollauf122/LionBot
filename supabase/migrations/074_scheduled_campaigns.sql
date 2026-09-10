-- Campanhas de postagem agendada: N mensagens ao longo do tempo pra 1 destino.
-- É a transposta de mtproto_campaigns (1 texto x N alvos), e por isso mora em
-- tabela própria: o poller de queue.ts:481 varre mtproto_campaigns com
-- status='scheduled' e enfileira campaign.run, que cairia no CampaignRunner de
-- Mass DM e tentaria mandar DM pros "alvos" de uma campanha de conteúdo.

create table if not exists public.mtproto_scheduled_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null default '',

  -- Destino: um dialog existente do tenant. null enquanto o rascunho não
  -- escolheu. channel_id/access_hash são snapshot — o dialog pode sumir no
  -- próximo sync, mesmo raciocínio de clone_jobs.source_peer_id (049).
  dest_dialog_id uuid references public.mtproto_dialogs(id) on delete set null,
  dest_channel_id text,
  dest_access_hash text,
  dest_title text,

  source_clone_job_id uuid,

  status text not null default 'draft'
    check (status in ('draft','ai_processing','ready','running','paused','completed','failed')),

  start_at timestamptz,
  default_delay_seconds int not null default 900,

  ai_clean boolean not null default false,
  ai_rewrite boolean not null default false,
  ai_smart_delay boolean not null default false,
  ai_status text not null default 'idle'
    check (ai_status in ('idle','queued','processing','done','partial','failed')),
  ai_processed_count int not null default 0,
  ai_error text,
  -- TTL da trava de processamento da IA, mesmo papel de
  -- mtproto_campaigns.processing_started_at (030): sem isso a campanha fica
  -- presa em ai_processing pra sempre se o worker morrer no meio.
  ai_started_at timestamptz,

  total_messages int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mtproto_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null
    references public.mtproto_scheduled_campaigns(id) on delete cascade,

  -- ── Espelho de social_proof_messages. Estes nomes são CONTRATO com
  --    FeedPreview/MessageEditor/MediaPicker: renomear quebra a UI reusada.
  kind text not null default 'text'
    check (kind in ('text','photo','video','audio','album','document','poll')),
  content_text text,
  media jsonb not null default '[]'::jsonb,   -- MediaItem[], mesmo shape da 073
  reply_to_id uuid references public.mtproto_scheduled_messages(id) on delete set null,
  position integer not null default 0,

  -- ── Agendamento. delay_seconds é o que o usuário edita (relativo à
  --    anterior); scheduled_at é derivado, escrito uma vez no launch.
  delay_seconds int not null default 900,
  scheduled_at timestamptz,
  silent boolean not null default true,

  -- ── Envio
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','skipped')),
  dest_msg_id bigint,
  sent_at timestamptz,
  error_message text,
  attempts int not null default 0,
  claimed_at timestamptz,

  -- ── Procedência do clone: o que o publish-router hoje entrega direto ao
  --    Telegram e que, num rascunho, precisa sobreviver em repouso.
  source_msg_id bigint,
  entities jsonb,        -- Api.MessageEntity[] cruas: negrito, link, spoiler
  inline_links jsonb,    -- [{label,url}] quando copy_buttons
  poll jsonb,            -- SourcePoll: question, options, isAnonymous, ...
  file_name text,
  is_pinned boolean not null default false,

  -- ── IA
  content_text_original text,
  ai_action text check (ai_action in ('none','cleaned','rewritten','discarded')),
  ai_reason text,
  ai_discarded boolean not null default false,

  created_at timestamptz not null default now(),
  constraint sched_msgs_has_content
    check (content_text is not null
           or jsonb_array_length(media) > 0
           or poll is not null)
);

-- Idempotência do rascunho. A 050 documenta que publish() NÃO é idempotente:
-- dois runners no mesmo lote duplicam posts no destino. No modo rascunho o
-- publish vira upsert nesta chave, então uma retomada pós-FLOOD_WAIT que
-- reprocesse um lote já gravado sobrescreve em vez de duplicar.
--
-- Índice CHEIO, nunca parcial. Um predicado `where source_msg_id is not null`
-- aqui não compra nada — o Postgres já trata NULL como distinto em índice
-- único, então linhas sem source_msg_id (mensagem criada à mão na campanha)
-- convivem sem colidir de qualquer jeito. E ele QUEBRA o upsert: o
-- `ON CONFLICT` só infere índice parcial se a instrução repetir o mesmo
-- predicado, coisa que o PostgREST não emite (o on_conflict dele só carrega
-- nomes de coluna) — o que dava 42P10 na primeira gravação de todo job de
-- rascunho. Não recoloque o predicado.
drop index if exists public.idx_sched_msgs_source;
create unique index if not exists idx_sched_msgs_source
  on public.mtproto_scheduled_messages (campaign_id, source_msg_id);

-- O poller do worker de disparo. Parcial porque só 'pending' é consultado.
create index if not exists idx_sched_msgs_due
  on public.mtproto_scheduled_messages (status, scheduled_at) where status = 'pending';

-- A leitura da tela, com o mesmo desempate por created_at da 071: sem ele,
-- position repetida deixa a ordem do composer divergir da ordem de envio.
create index if not exists idx_sched_msgs_campaign_pos
  on public.mtproto_scheduled_messages (campaign_id, position, created_at);

alter table public.mtproto_scheduled_campaigns enable row level security;
alter table public.mtproto_scheduled_messages enable row level security;

-- is_admin() acompanha o padrão da 007 e da 071: o admin da plataforma
-- gerencia a automação do cliente, e sem isso a tela abriria vazia pra ele.
drop policy if exists "tenant manages own scheduled campaigns"
  on public.mtproto_scheduled_campaigns;
create policy "tenant manages own scheduled campaigns"
  on public.mtproto_scheduled_campaigns for all
  using (tenant_id = auth.uid() or public.is_admin())
  with check (tenant_id = auth.uid() or public.is_admin());

drop policy if exists "tenant manages own scheduled messages"
  on public.mtproto_scheduled_messages;
create policy "tenant manages own scheduled messages"
  on public.mtproto_scheduled_messages for all
  using (campaign_id in (
    select id from public.mtproto_scheduled_campaigns
    where tenant_id = auth.uid() or public.is_admin()
  ))
  with check (campaign_id in (
    select id from public.mtproto_scheduled_campaigns
    where tenant_id = auth.uid() or public.is_admin()
  ));
