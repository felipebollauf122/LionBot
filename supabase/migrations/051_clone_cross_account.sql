-- Clone cross-account: ler a origem numa conta e criar o destino em outra.
-- A conta de origem pode estar USER_RESTRICTED (limitada pelo Telegram de criar
-- canais) mas ainda lê/baixa normalmente; outra conta não-restrita cria o destino.

-- Flag reativo: setado true quando um channels.CreateChannel dessa conta volta
-- USER_RESTRICTED, limpo false quando um CreateChannel dela dá certo. O seletor
-- de conta de destino no formulário de clone só oferece contas com false.
alter table public.mtproto_accounts
  add column if not exists create_restricted boolean not null default false;

-- Conta que CRIA o destino. null = mesma conta da origem (retrocompatível com
-- jobs criados antes desta feature).
alter table public.clone_jobs
  add column if not exists dest_account_id uuid references public.mtproto_accounts(id);
