-- Admin RLS bypass pra media_assets, no mesmo padrão do 007_admin_rls.sql e
-- 062_automations_admin_rls.sql. A tabela foi criada em 059_media_library.sql
-- sem esse bypass — o editor de remarketing admin (que passa a chamar
-- listMediaAssets(botId) pro usuário impersonado) ficava com a lista de
-- mídias sempre vazia pro admin, mesmo quando o dono do bot tem mídias
-- cadastradas na Biblioteca de Mídia.

drop policy if exists "Tenants can manage own media assets" on public.media_assets;
create policy "Tenants can manage own media assets" on public.media_assets
  for all using (tenant_id = auth.uid() OR public.is_admin())
  with check (tenant_id = auth.uid() OR public.is_admin());
