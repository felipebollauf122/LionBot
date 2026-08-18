-- Troca de @mentions/links por categoria (bot/grupo/canal) dentro do
-- conteúdo clonado. Três colunas nullable, uma por categoria — null (a
-- server action normaliza string vazia pra null) = aquela categoria não é
-- trocada, sem estado extra pra sincronizar. Mesmo padrão de
-- dest_invite_link (049_channel_clone.sql): a própria ausência do valor já
-- é o "feature flag" daquela categoria.
--
-- link_replace_bot: username sem @ (normalizado pela server action).
-- link_replace_group / link_replace_channel: link, salvo como digitado.

alter table public.clone_jobs
  add column if not exists link_replace_bot text,
  add column if not exists link_replace_group text,
  add column if not exists link_replace_channel text;
