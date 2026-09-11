-- Isolated test database only; never run this bootstrap in Supabase.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create table public.tenants (id uuid primary key);
create table public.mtproto_accounts (id uuid primary key,tenant_id uuid references tenants(id),status text);
create table public.mtproto_dialogs (id uuid primary key,account_id uuid references mtproto_accounts(id),peer_type text,peer_id text,kind text);
