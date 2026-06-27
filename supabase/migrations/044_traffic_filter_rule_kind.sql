-- 044_traffic_filter_rule_kind.sql
-- Classe da regra de filtro de tráfego. Identifica o crawler do Facebook de
-- forma robusta (coluna, não string da nota) para a UI poder destravá-lo e
-- deixar o usuário movê-lo da allowlist pra blocklist se quiser.
--
-- ATENÇÃO: mover o crawler do FB pra blocklist = cloaking (o crawler revisor
-- vê conteúdo diferente do usuário) = anúncio reprovado / conta banida. A UI
-- avisa disso na hora de mover; aqui a coluna só dá a classe pra UI decidir.

ALTER TABLE public.traffic_filter_rules
  ADD COLUMN IF NOT EXISTS rule_kind text NOT NULL DEFAULT 'custom'
    CHECK (rule_kind IN ('fb_crawler','custom'));

-- Backfill: as seeds existentes do crawler FB (criadas pela migration 043,
-- identificadas pela nota) viram a classe 'fb_crawler'.
UPDATE public.traffic_filter_rules
SET rule_kind = 'fb_crawler'
WHERE rule_kind = 'custom'
  AND list = 'allow'
  AND match_type = 'user_agent'
  AND note ILIKE '%crawler FB%';

-- Garante a seed do crawler FB pra tenants criados DEPOIS da 043 mas ANTES da 044
-- (ou que por algum motivo não a tenham). Reusa o mesmo conjunto de user-agents.
-- ON CONFLICT DO NOTHING não dispara aqui (não há unique constraint), então só
-- insere onde a tenant ainda não tem nenhuma regra fb_crawler.
INSERT INTO public.traffic_filter_rules (tenant_id, list, match_type, value, note, rule_kind)
SELECT t.id, 'allow', 'user_agent', ua.value, 'crawler FB (anti-cloaking) — não remover', 'fb_crawler'
FROM public.tenants t
CROSS JOIN (VALUES ('facebookexternalhit'), ('facebookcatalog'), ('meta-externalagent')) AS ua(value)
WHERE NOT EXISTS (
  SELECT 1 FROM public.traffic_filter_rules r
  WHERE r.tenant_id = t.id
    AND r.rule_kind = 'fb_crawler'
    AND r.value = ua.value
);
