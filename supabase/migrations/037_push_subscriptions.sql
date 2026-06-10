-- Web Push subscriptions — one row per device a tenant enables push on.
-- Used by the server to send "sale approved" notifications to the user's devices.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (tenant_id, endpoint)
);

create index if not exists idx_push_subscriptions_tenant on public.push_subscriptions(tenant_id);

alter table public.push_subscriptions enable row level security;

-- Tenants manage only their own subscriptions (front-end via anon key + auth).
create policy "own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = tenant_id)
  with check (auth.uid() = tenant_id);

-- The server uses the service-role key, which bypasses RLS, to read all
-- subscriptions of a tenant when a sale is approved.
