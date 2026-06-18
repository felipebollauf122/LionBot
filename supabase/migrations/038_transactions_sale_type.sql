-- Classificação da venda (main/upsell/downsell/orderbump) — marcada MANUALMENTE
-- no nó de pagamento do editor de fluxo. Default 'main' mantém compatibilidade
-- com todas as transações existentes (que passam a contar como venda principal).
alter table public.transactions
  add column sale_type text not null default 'main'
    check (sale_type in ('main', 'upsell', 'downsell', 'orderbump'));

-- Acelera a agregação por tipo de venda nas Análises (por tenant + período).
create index if not exists idx_transactions_sale_type
  on public.transactions(tenant_id, sale_type, status, created_at);
