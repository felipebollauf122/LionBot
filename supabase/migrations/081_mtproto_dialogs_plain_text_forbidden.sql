-- CHAT_SEND_PLAIN_FORBIDDEN: destino que nao aceita mensagem de TEXTO puro.
-- E permissao do chat (direito send_plain em ChatBannedRights), nao da conta:
-- trocar de conta da a mesma recusa.
--
-- Sem marcar aqui, apagar o target nao resolve nada: refreshGlobalCampaignTargets
-- recria os targets a partir de mtproto_dialogs a cada ciclo, entao o destino
-- morto voltaria pra fila toda vez e queimaria um request por ciclo, pra sempre.
-- Marcando no dialog, ele some do rebuild e o alcance real sobe.
alter table public.mtproto_dialogs
  add column plain_text_forbidden boolean not null default false,
  add column plain_text_forbidden_at timestamptz;

-- Os rebuilds de campanha global filtram por (account_id, kind) e agora tambem
-- por este flag; o indice parcial mantem a query barata sem inchar o indice.
create index idx_mtproto_dialogs_sendable
  on public.mtproto_dialogs(account_id, kind)
  where plain_text_forbidden = false;
