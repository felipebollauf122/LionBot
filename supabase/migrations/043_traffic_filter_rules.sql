-- 043_traffic_filter_rules.sql
-- Filtro de tráfego: allowlist/blocklist explícita por tenant na página /t.
-- A lista É o veredito — ALLOW vence BLOCK, regra explícita vence default-por-sinal.

CREATE TABLE IF NOT EXISTS public.traffic_filter_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  list        text NOT NULL CHECK (list IN ('allow','block')),
  match_type  text NOT NULL CHECK (match_type IN ('ip','user_agent','referer','asn')),
  value       text NOT NULL,
  note        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tfr_lookup
  ON public.traffic_filter_rules (tenant_id, is_active, list, match_type);

-- Toggle por bot. Começa DESLIGADO — não afeta bots existentes.
ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS traffic_filter_enabled boolean NOT NULL DEFAULT false;

-- Seeds anti-cloaking: o crawler de revisão do FB SEMPRE vê a /t real.
-- Uma regra ALLOW por user_agent, para cada tenant existente.
INSERT INTO public.traffic_filter_rules (tenant_id, list, match_type, value, note)
SELECT t.id, 'allow', 'user_agent', ua.value, 'crawler FB (anti-cloaking) — não remover'
FROM public.tenants t
CROSS JOIN (VALUES ('facebookexternalhit'), ('facebookcatalog'), ('meta-externalagent')) AS ua(value)
ON CONFLICT DO NOTHING;
