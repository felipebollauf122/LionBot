-- Persiste o tema do usuário na conta (antes era só localStorage, que o Brave
-- apaga). theme = id do preset ou "custom"; custom_theme = paleta custom (JSON).
-- tenants.name já existe (001) — usado pra o nome editável da dashboard.
alter table public.tenants
  add column if not exists theme text,
  add column if not exists custom_theme jsonb;
