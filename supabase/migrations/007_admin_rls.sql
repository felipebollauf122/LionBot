-- EagleBot: Admin role RLS bypass

-- Coluna 'role' usada pelo is_admin() abaixo. Garante que exista (idempotente):
-- no banco antigo já existe; em banco novo, cria. Sem isso, a função falha.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

-- Helper function: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- TENANTS
DROP POLICY "Tenants can view own data" ON public.tenants;
CREATE POLICY "Tenants can view own or admin all" ON public.tenants
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

DROP POLICY "Tenants can update own data" ON public.tenants;
CREATE POLICY "Tenants can update own or admin all" ON public.tenants
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

-- BOTS
DROP POLICY "Tenants can manage own bots" ON public.bots;
CREATE POLICY "Tenants can manage own bots or admin all" ON public.bots
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- PRODUCTS
DROP POLICY "Tenants can manage own products" ON public.products;
CREATE POLICY "Tenants can manage own products or admin all" ON public.products
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- PRODUCT BUNDLES
DROP POLICY "Tenants can manage own bundles" ON public.product_bundles;
CREATE POLICY "Tenants can manage own bundles or admin all" ON public.product_bundles
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- BUNDLE ITEMS
DROP POLICY "Tenants can manage bundle items" ON public.product_bundle_items;
CREATE POLICY "Tenants can manage bundle items or admin all" ON public.product_bundle_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.product_bundles pb WHERE pb.id = bundle_id AND pb.tenant_id = auth.uid())
    OR public.is_admin()
  );

-- FLOWS
DROP POLICY "Tenants can manage own flows" ON public.flows;
CREATE POLICY "Tenants can manage own flows or admin all" ON public.flows
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- LEADS
DROP POLICY "Tenants can manage own leads" ON public.leads;
CREATE POLICY "Tenants can manage own leads or admin all" ON public.leads
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- TRANSACTIONS
DROP POLICY "Tenants can manage own transactions" ON public.transactions;
CREATE POLICY "Tenants can manage own transactions or admin all" ON public.transactions
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- TRACKING EVENTS
DROP POLICY "Tenants can manage own tracking events" ON public.tracking_events;
CREATE POLICY "Tenants can manage own tracking events or admin all" ON public.tracking_events
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- REMARKETING CONFIGS
DROP POLICY "Tenants can manage own remarketing configs" ON public.remarketing_configs;
CREATE POLICY "Tenants can manage own remarketing configs or admin all" ON public.remarketing_configs
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- REMARKETING FLOWS
DROP POLICY "Tenants can manage own remarketing flows" ON public.remarketing_flows;
CREATE POLICY "Tenants can manage own remarketing flows or admin all" ON public.remarketing_flows
  FOR ALL USING (tenant_id = auth.uid() OR public.is_admin());

-- REMARKETING PROGRESS
DROP POLICY "Tenants can view own remarketing progress" ON public.remarketing_progress;
CREATE POLICY "Tenants can view remarketing progress or admin all" ON public.remarketing_progress
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.bots b WHERE b.id = bot_id AND b.tenant_id = auth.uid())
    OR public.is_admin()
  );
