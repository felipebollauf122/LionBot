-- Pixel reserva (aquecimento de conta): além do pixel principal (facebook_pixel_id
-- + facebook_access_token), o bot pode ter um SEGUNDO pixel que recebe uma CÓPIA
-- de todos os eventos do Facebook CAPI. Serve pra aquecer uma conta nova em
-- paralelo, sem pausa, pronta pra assumir quando precisar trocar.
-- Só envia pro reserva quando facebook_backup_enabled = true.

alter table public.bots
  add column if not exists facebook_pixel_id_backup text,
  add column if not exists facebook_access_token_backup text,
  add column if not exists facebook_backup_enabled boolean not null default false;
