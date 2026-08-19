-- Coluna is_premium: cargo de assinante premium — acesso extra a features pagas
-- (hoje: página de Automações). Diferente de is_owner (singleton, só 1 por
-- instância) e role='admin' (acesso administrativo/RLS bypass) — múltiplos
-- usuários podem ser premium simultaneamente.
alter table public.tenants
  add column if not exists is_premium boolean not null default false;

-- Helper SQL function pra checks de RLS / actions futuras
create or replace function public.is_premium()
returns boolean
language sql
stable
security definer
as $$
  select coalesce(
    (select is_premium from public.tenants where id = auth.uid()),
    false
  );
$$;
