-- 047_slug_gate.sql
-- Chave de segurança final: um "slug" secreto que vai nos parâmetros do link do
-- anúncio (&s=<slug>). Quando ativo, só acessa o bot quem trouxer o slug certo.
--
-- O slug em si NÃO é guardado — guardamos só o HASH (SHA-256 hex). O segredo
-- vive na URL do anúncio (que você controla) e no que o usuário copiou uma vez.
-- Como vai na URL, a proteção vem do slug ser ALEATÓRIO/secreto, não de cifra:
-- quem não tem o link com o slug certo não passa.

ALTER TABLE public.bots
  ADD COLUMN IF NOT EXISTS slug_gate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slug_hash text,
  ADD COLUMN IF NOT EXISTS slug_plain text;

COMMENT ON COLUMN public.bots.slug_gate_enabled IS
  'Chave de segurança final: se true, só acessa a /t quem trouxer ?s=<slug> que bata com slug_hash.';
COMMENT ON COLUMN public.bots.slug_hash IS
  'SHA-256 (hex) do slug secreto — usado na verificação em tempo constante na /t.';
COMMENT ON COLUMN public.bots.slug_plain IS
  'Slug em claro, pra montar o link de cópia. Já é público na URL do anúncio, então não é segredo no banco. Aleatório = impossível de adivinhar.';
