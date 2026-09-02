-- Prova social: feed simulado de canal do Telegram, exibido no Mini App.
-- Canal simulado: um por bot.
create table public.social_proof_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  title text not null default '',
  avatar_url text,
  subscribers_label text not null default '',
  is_verified boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bot_id)
);
alter table public.social_proof_channels enable row level security;
-- is_admin() acompanha o padrão da migration 007: o admin da plataforma
-- gerencia o bot do cliente, e sem isso a aba abriria vazia pra ele.
create policy "Tenants can manage own social proof channels"
  on public.social_proof_channels for all
  using (tenant_id = auth.uid() or public.is_admin());

create table public.social_proof_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bot_id uuid not null references public.bots(id) on delete cascade,
  channel_id uuid not null references public.social_proof_channels(id) on delete cascade,
  sender_name text not null default '',
  sender_avatar_url text,
  content_text text,
  media_url text,
  media_type text check (media_type in ('image', 'video')),
  -- Há quantos segundos a mensagem "aconteceu", contado do agora do lead.
  -- Guardar distância e não data absoluta é o que mantém o feed sempre fresco.
  offset_seconds integer not null default 0,
  views_count integer not null default 0,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint social_proof_messages_has_content
    check (content_text is not null or media_url is not null),
  constraint social_proof_messages_media_type_consistent
    check ((media_url is null) = (media_type is null))
);
alter table public.social_proof_messages enable row level security;
create policy "Tenants can manage own social proof messages"
  on public.social_proof_messages for all
  using (tenant_id = auth.uid() or public.is_admin());

create index idx_social_proof_messages_feed
  on public.social_proof_messages (bot_id, is_active, position);
