-- Permanent content libraries, one workspace per destination. Existing campaigns
-- and clones are retained; this migration does not rewrite their data.
create table public.automation_libraries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  dest_dialog_id uuid references public.mtproto_dialogs(id) on delete set null,
  rules jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  next_send_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id, dest_dialog_id)
);
create table public.automation_library_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  library_id uuid not null,
  source_dialog_id uuid references public.mtproto_dialogs(id) on delete set null,
  import_history boolean not null default true,
  watch boolean not null default false,
  status text not null default 'pending' check (status in ('pending','importing','watching','paused','failed','completed')),
  cursor_message_id bigint not null default 0,
  history_until_message_id bigint,
  watch_cursor_message_id bigint,
  watch_lease_until timestamptz,
  imported_count integer not null default 0,
  last_error text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique (library_id, source_dialog_id),
  unique (id, library_id, tenant_id),
  foreign key (library_id, tenant_id) references public.automation_libraries(id, tenant_id) on delete cascade,
  check (import_history or watch)
);
create table public.automation_library_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  library_id uuid not null,
  source_id uuid not null,
  source_message_id bigint not null,
  source_grouped_id text,
  is_live boolean not null default false,
  original jsonb not null,
  processed jsonb,
  status text not null default 'pending' check (status in ('pending','processing','ready','skipped','failed')),
  delivery_status text not null default 'draft' check (delivery_status in ('draft','pending','sending','sent','failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  dest_message_id bigint,
  last_error text,
  processing_started_at timestamptz,
  delivery_claimed_at timestamptz,
  delivery_receipts jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  unique (source_id, source_message_id),
  foreign key (library_id, tenant_id) references public.automation_libraries(id, tenant_id) on delete cascade,
  foreign key (source_id, library_id, tenant_id) references public.automation_library_sources(id, library_id, tenant_id) on delete cascade
);
create index automation_sources_work on public.automation_library_sources(status,lease_until);
create index automation_items_work on public.automation_library_items(status,created_at);
create index automation_items_live_priority on public.automation_library_items(library_id,is_live desc,created_at) where status='pending';
create index automation_items_due on public.automation_library_items(delivery_status,scheduled_at);
create index automation_items_library on public.automation_library_items(library_id,created_at,id);

alter table public.automation_libraries enable row level security;
alter table public.automation_library_sources enable row level security;
alter table public.automation_library_items enable row level security;
create policy library_owner on public.automation_libraries for all
  using (tenant_id = auth.uid() or public.is_admin())
  with check (tenant_id = auth.uid() or public.is_admin());
create policy library_source_owner on public.automation_library_sources for all
  using (tenant_id = auth.uid() or public.is_admin())
  with check (tenant_id = auth.uid() or public.is_admin());
create policy library_item_owner on public.automation_library_items for all
  using (tenant_id = auth.uid() or public.is_admin())
  with check (tenant_id = auth.uid() or public.is_admin());

-- Enforce ownership even for a direct PostgREST call, not just Server Actions.
create function public.validate_library_dialog_owner() returns trigger
language plpgsql set search_path = public as $$
declare dialog_id uuid;
begin
  if tg_table_name = 'automation_libraries' then dialog_id := new.dest_dialog_id;
  else dialog_id := new.source_dialog_id;
  end if;
  if dialog_id is not null and not exists (
    select 1 from public.mtproto_dialogs d join public.mtproto_accounts a on a.id=d.account_id
    where d.id=dialog_id and a.tenant_id=new.tenant_id and d.peer_type in ('channel','chat')
  ) then raise exception 'Canal ou grupo não pertence às contas deste usuário.';
  end if;
  return new;
end $$;
create trigger library_dialog_owner before insert or update on public.automation_libraries
  for each row execute function public.validate_library_dialog_owner();
create trigger library_source_dialog_owner before insert or update on public.automation_library_sources
  for each row execute function public.validate_library_dialog_owner();

create function public.preserve_library_original() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.original is distinct from old.original or new.source_id is distinct from old.source_id
    or new.source_message_id is distinct from old.source_message_id
    or new.library_id is distinct from old.library_id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'O original e a procedência do acervo são imutáveis.';
  end if;
  return new;
end $$;
create trigger library_original_immutable before update on public.automation_library_items
  for each row execute function public.preserve_library_original();

-- Service-role-only RPCs.
-- Deliberately no automatic reclamation of delivery_status='sending': a crash
-- after Telegram accepted the request cannot safely be retried by the Bot API.
create index if not exists automation_library_due_idx on public.automation_library_items
  (library_id, scheduled_at) where status = 'ready' and delivery_status = 'pending';
create index if not exists automation_library_album_idx on public.automation_library_items
  (source_id, source_grouped_id, source_message_id);

create or replace function public.automation_library_finish_processing(
  p_item_id uuid, p_started_at timestamptz, p_processed jsonb, p_rules jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare i automation_library_items; l automation_libraries; at_time timestamptz; mode text; cadence int;
begin
  select * into i from automation_library_items where id = p_item_id;
  if not found then return false; end if;
  select * into l from automation_libraries where id = i.library_id and tenant_id = i.tenant_id for update;
  if not found then return false; end if;
  select * into i from automation_library_items where id = p_item_id for update;
  if i.status <> 'processing' or i.processing_started_at is distinct from p_started_at then return false; end if;
  -- A pause invalidates in-flight treatments, so changed rules never queue an old result.
  if not l.enabled or l.rules is distinct from p_rules then
    update automation_library_items set status='pending', processing_started_at=null where id=i.id;
    return false;
  end if;
  if not exists (select 1 from automation_library_sources s where s.id=i.source_id and s.library_id=l.id and s.tenant_id=l.tenant_id) then
    raise exception 'Source/library tenant mismatch';
  end if;
  mode := coalesce(l.rules->>'delivery_mode', 'review');
  if mode not in ('review','immediate','interval') then raise exception 'Invalid delivery mode'; end if;
  cadence := coalesce((l.rules->>'interval_seconds')::int, 60);
  if mode = 'interval' and cadence < 1 then raise exception 'Invalid interval'; end if;
  if not coalesce((p_processed->>'discard')::boolean, false) and mode <> 'review' then
    at_time := greatest(clock_timestamp(), (l.rules->>'start_at')::timestamptz, (p_processed->>'scheduledAt')::timestamptz)
      + make_interval(secs => coalesce((p_processed->>'delaySeconds')::int,0));
    if mode = 'interval' then
      at_time := greatest(at_time, l.next_send_at);
      update automation_libraries set next_send_at=at_time + make_interval(secs => cadence) where id=l.id;
    end if;
  end if;
  update automation_library_items set processed=p_processed,
    status=case when coalesce((p_processed->>'discard')::boolean,false) then 'skipped' else 'ready' end,
    delivery_status=case when at_time is null then 'draft' else 'pending' end,
    scheduled_at=at_time, processing_started_at=null, last_error=null
    where id=i.id;
  return true;
end $$;

create or replace function public.automation_library_claim_due(p_library_id uuid)
returns setof public.automation_library_items language plpgsql security definer set search_path = public as $$
declare l automation_libraries; i automation_library_items; cadence int;
begin
  select * into l from automation_libraries where id=p_library_id;
  if not found then return; end if;
  -- One request in flight per companion bot, including competing replicas.
  perform pg_advisory_xact_lock(hashtextextended('automation-library-send:' || l.tenant_id::text,0));
  select * into l from automation_libraries where id=p_library_id and enabled for update;
  if not found then return; end if;
  if exists(select 1 from automation_library_items where tenant_id=l.tenant_id and delivery_status='sending') then return; end if;
  if not exists(select 1 from mtproto_dialogs d join mtproto_accounts a on a.id=d.account_id where d.id=l.dest_dialog_id and a.tenant_id=l.tenant_id and d.peer_type in ('channel','chat')) then
    raise exception 'Invalid destination or tenant';
  end if;
  cadence := case when l.rules->>'delivery_mode'='interval' then greatest(1,coalesce((l.rules->>'interval_seconds')::int,60)) else 1 end;
  if exists(select 1 from automation_library_items where library_id=l.id and sent_at > clock_timestamp()-make_interval(secs=>cadence)) then return; end if;
  select x.* into i from automation_library_items x join automation_library_sources s on s.id=x.source_id
    where x.library_id=l.id and x.tenant_id=l.tenant_id and s.tenant_id=l.tenant_id and s.library_id=l.id
      -- Already archived content remains usable if the source disappears.
      and s.status <> 'paused' and x.status='ready' and x.processed is not null
      and not coalesce((x.processed->>'discard')::boolean,false)
      and x.delivery_status='pending' and x.scheduled_at <= clock_timestamp()
    order by x.scheduled_at, x.source_message_id for update of x, s skip locked limit 1;
  if not found then return; end if;
  return query update automation_library_items set delivery_status='sending', delivery_claimed_at=clock_timestamp(),
    attempts=coalesce(attempts,0)+1, last_error=null where id=i.id returning *;
end $$;

create or replace function public.automation_library_defer_flood(p_item_id uuid, p_claimed_at timestamptz, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare i automation_library_items; delay interval;
begin
  select * into i from automation_library_items where id=p_item_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('automation-library-send:' || i.tenant_id::text,0));
  select * into i from automation_library_items where id=p_item_id for update;
  if i.delivery_status <> 'sending' or i.delivery_claimed_at is distinct from p_claimed_at then return false; end if;
  delay := make_interval(secs=>greatest(1,least(p_seconds,31536000))+1);
  update automation_library_items set delivery_status='pending', delivery_claimed_at=null,
    last_error='Telegram flood: envio reagendado' where id=i.id;
  update automation_library_items set scheduled_at=greatest(scheduled_at,clock_timestamp())+delay
    where tenant_id=i.tenant_id and delivery_status='pending' and scheduled_at is not null;
  update automation_libraries set next_send_at=greatest(next_send_at,clock_timestamp())+delay where tenant_id=i.tenant_id;
  return true;
end $$;

revoke all on function public.automation_library_finish_processing(uuid,timestamptz,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.automation_library_claim_due(uuid) from public, anon, authenticated;
revoke all on function public.automation_library_defer_flood(uuid,timestamptz,int) from public, anon, authenticated;
grant execute on function public.automation_library_finish_processing(uuid,timestamptz,jsonb,jsonb) to service_role;
grant execute on function public.automation_library_claim_due(uuid) to service_role;
grant execute on function public.automation_library_defer_flood(uuid,timestamptz,int) to service_role;
