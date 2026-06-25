-- Texto explicativo da página de tracking (/t) por bot. Aparece como o conteúdo
-- "substancial" que o Facebook exige (página de ponte sem conteúdo é marcada como
-- link enganoso/baixa qualidade). Se vazio, a /t usa um texto genérico de fallback.
alter table public.bots
  add column if not exists tracking_page_intro text;
