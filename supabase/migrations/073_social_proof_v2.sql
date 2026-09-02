-- Prova social v2: identidade da dona, tipos de mensagem, mídia em lista,
-- reações, resposta e mensagem fixada.
--
-- INCREMENTAL de propósito: a 071 já está aplicada em produção.

-- ─── Canal ────────────────────────────────────────────────────────────────
alter table public.social_proof_channels
  add column if not exists owner_name text not null default '',
  add column if not exists owner_avatar_url text,
  add column if not exists owner_username text not null default '',
  add column if not exists pinned_message_id uuid,
  add column if not exists unread_badge integer not null default 0;

-- ─── Mensagem ─────────────────────────────────────────────────────────────
alter table public.social_proof_messages
  add column if not exists sender_kind text not null default 'member',
  add column if not exists kind text not null default 'text',
  add column if not exists media jsonb not null default '[]'::jsonb,
  add column if not exists reactions jsonb not null default '[]'::jsonb,
  add column if not exists reply_to_id uuid,
  add column if not exists display_time text;

-- ─── Backfill ─────────────────────────────────────────────────────────────
-- ANTES de trocar as constraints: as linhas existentes (media_url preenchido,
-- media ainda vazia) violariam a regra nova no instante em que ela nascesse.
update public.social_proof_messages
set media = jsonb_build_array(
      jsonb_build_object(
        'url', media_url,
        'type', case when media_type = 'image' then 'photo' else media_type end
      )
    ),
    kind = case when media_type = 'image' then 'photo' else 'video' end
where media_url is not null
  and media = '[]'::jsonb;

-- ─── Constraints ──────────────────────────────────────────────────────────
-- has_content da 071 exigia content_text OU media_url. Uma mensagem de álbum
-- tem a mídia na lista e media_url nulo — o banco recusaria o insert.
alter table public.social_proof_messages
  drop constraint if exists social_proof_messages_has_content,
  drop constraint if exists social_proof_messages_media_type_consistent;

alter table public.social_proof_messages
  add constraint social_proof_messages_has_content_v2
    check (content_text is not null or jsonb_array_length(media) > 0),
  add constraint social_proof_messages_sender_kind
    check (sender_kind in ('owner', 'member')),
  add constraint social_proof_messages_kind
    check (kind in ('text', 'photo', 'video', 'audio', 'album'));

-- ─── Chaves estrangeiras ──────────────────────────────────────────────────
-- on delete set null nos dois: apagar a mensagem fixada desafixa em vez de
-- derrubar o canal, e apagar a respondida deixa a resposta órfã em vez de
-- cascatear e sumir com uma mensagem que o tenant não mandou apagar.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'social_proof_channels_pinned_fk'
  ) then
    alter table public.social_proof_channels
      add constraint social_proof_channels_pinned_fk
        foreign key (pinned_message_id)
        references public.social_proof_messages(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'social_proof_messages_reply_fk'
  ) then
    alter table public.social_proof_messages
      add constraint social_proof_messages_reply_fk
        foreign key (reply_to_id)
        references public.social_proof_messages(id) on delete set null;
  end if;
end $$;
