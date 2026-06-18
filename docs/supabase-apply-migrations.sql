-- ════════════════════════════════════════════════════════════════════════════
-- APLICAR NO SQL EDITOR DO SUPABASE (painel → SQL Editor → New query → cole tudo → Run)
-- Projeto: rwqkxusjxdaiewrsvgvb
--
-- Junta as migrations 037 (push) + 038 (sale_type). É IDEMPOTENTE: pode rodar
-- mais de uma vez sem erro (usa "if not exists" / "drop ... if exists").
-- ════════════════════════════════════════════════════════════════════════════

-- ── 037: Web Push subscriptions (1 linha por dispositivo que ativa o push) ──
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

create index if not exists idx_push_subscriptions_tenant
  on public.push_subscriptions(tenant_id);

alter table public.push_subscriptions enable row level security;

-- policy não aceita "if not exists" → derruba antes de recriar (seguro repetir)
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions"
  on public.push_subscriptions
  for all
  using (auth.uid() = tenant_id)
  with check (auth.uid() = tenant_id);


-- ── 038: classificação da venda (main/upsell/downsell/orderbump) ──
-- "add column if not exists" mantém idempotente; default 'main' não quebra
-- transações existentes.
alter table public.transactions
  add column if not exists sale_type text not null default 'main';

-- garante o CHECK só se ainda não existir (evita erro ao repetir)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_sale_type_check'
  ) then
    alter table public.transactions
      add constraint transactions_sale_type_check
      check (sale_type in ('main', 'upsell', 'downsell', 'orderbump'));
  end if;
end $$;

create index if not exists idx_transactions_sale_type
  on public.transactions(tenant_id, sale_type, status, created_at);
